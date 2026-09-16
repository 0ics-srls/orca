import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Run with ORCA_BACKGROUND_LAUNCH=1.')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const hash = (source) => createHash('sha256').update(source).digest('hex')
const changedPath = 'src/relay/dispatcher-rpc-routing.ts'
const current = await readFile(resolve(root, changedPath), 'utf8')
const marker =
  "const accepted = this.enqueuePreparedFrame(client, frame, lane, onSettled, 'reject')"
assert.equal(current.split(marker).length, 2, 'Source changed; review the baseline transform.')
const baseline = current.replace(
  marker,
  'const accepted = this.enqueuePreparedFrame(client, frame, lane, onSettled)'
)
const sourcePaths = [
  changedPath,
  'src/relay/pty-handler.ts',
  'src/relay/dispatcher-notification-publication.ts',
  'src/relay/dispatcher-writer-admission.ts',
  'src/relay/dispatcher-client-writer.ts',
  'src/main/providers/ssh-pty-provider.ts',
  'src/main/ssh/ssh-relay-session.ts',
  'src/main/ssh/ssh-channel-multiplexer.ts',
  'src/main/runtime/recent-pty-output-buffer.ts',
  'docs/audits/relay-replay-overflow/replay-fixture.test.ts'
]
const sources = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [path, hash(await readFile(resolve(root, path)))])
  )
)
const scratch = await mkdtemp(join(tmpdir(), 'orca-replay-capacity-'))
const require = createRequire(import.meta.url)
let runnerId
try {
  const runnerPath = join(scratch, 'run-process.cjs')
  await build({
    entryPoints: [resolve(root, 'src/shared/child-process/run-process.ts')],
    outfile: runnerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent'
  })
  runnerId = require.resolve(runnerPath)
  const { runProcess } = require(runnerId)
  const phases = []
  for (const phase of ['before', 'after']) {
    const config = join(scratch, `${phase}.config.mjs`)
    const observations = join(scratch, `${phase}.observations.json`)
    const report = join(scratch, `${phase}.tests.json`)
    await writeFile(
      config,
      `import base from ${JSON.stringify(pathToFileURL(resolve(root, 'config/vitest.config.ts')).href)};
export default {...base, plugins: ${
        phase === 'before'
          ? `[{name:'restore-historical-fatal-admission', enforce:'pre', transform(code,id) {
if(id.replaceAll('\\\\','/').split('?')[0] === ${JSON.stringify(resolve(root, changedPath).replaceAll('\\', '/'))}) return {code:${JSON.stringify(baseline)},map:null};
}}]`
          : '[]'
      }, test: {...base.test, include:['docs/audits/relay-replay-overflow/replay-fixture.test.ts'], maxWorkers:1, fileParallelism:false}};`
    )
    const run = await runProcess({
      program: process.execPath,
      args: [
        resolve(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        config,
        '--reporter=json',
        '--outputFile',
        report
      ],
      cwd: root,
      env: {
        ...process.env,
        ORCA_BACKGROUND_LAUNCH: '1',
        RECONNECT_PROOF_BASELINE: phase === 'before' ? '1' : '0',
        REPLAY_PROOF_OUTPUT: observations,
        NODE_OPTIONS: '--max-old-space-size=512'
      },
      timeoutMs: 45_000,
      maxOutputBytes: 64 * 1024
    })
    assert.equal(run.timedOut, false, `${phase}: timeout`)
    assert.equal(run.code, 0, `${phase}: ${run.stderr}\n${run.stdout}`)
    const counts = JSON.parse(await readFile(report, 'utf8'))
    assert.equal(counts.numPassedTests, 3)
    assert.equal(counts.numFailedTests, 0)
    phases.push({
      phase,
      passed: counts.numPassedTests,
      failed: counts.numFailedTests,
      observations: JSON.parse(await readFile(observations, 'utf8'))
    })
  }
  const historical = {}
  for (const path of [
    'src/relay/dispatcher.ts',
    'src/relay/dispatcher-writer-admission.ts',
    'src/relay/pty-handler.ts',
    'src/main/providers/ssh-pty-provider.ts',
    'src/main/ssh/ssh-relay-session.ts',
    'src/main/ssh/ssh-channel-multiplexer.ts'
  ]) {
    const read = await runProcess({
      program: 'git',
      args: ['show', `v1.4.163:${path}`],
      cwd: root,
      timeoutMs: 5_000,
      maxOutputBytes: 1024 * 1024
    })
    assert.equal(read.code, 0, read.stderr)
    historical[path] = read.stdout
  }
  const historicalChecks = {
    cappedReplay: historical['src/relay/pty-handler.ts'].includes(
      'export const REPLAY_BUFFER_MAX = 100 * 1024'
    ),
    suppressionSupported: historical['src/relay/pty-handler.ts'].includes(
      'if (params.suppressReplayNotification)'
    ),
    reconnectSuppressesNotification: historical['src/main/providers/ssh-pty-provider.ts'].includes(
      'suppressReplayNotification: true'
    ),
    eightReconnectWorkers: historical['src/main/ssh/ssh-relay-session.ts'].includes(
      'const SSH_PTY_REATTACH_MAX_CONCURRENCY = 8'
    ),
    fatalResponseAdmission: historical['src/relay/dispatcher.ts'].includes(
      'const accepted = this.enqueueFrame(client, msg, lane, onSettled)'
    ),
    oneMiBControlBudget: historical['src/relay/dispatcher-writer-admission.ts'].includes(
      'DISPATCHER_CONTROL_QUEUE_MAX_BYTES = 1024 * 1024'
    ),
    transportCloseMeansConnectionLost: historical[
      'src/main/ssh/ssh-channel-multiplexer.ts'
    ].includes("transport.onClose(() => {\n      this.dispose('connection_lost')")
  }
  assert(Object.values(historicalChecks).every(Boolean))
  process.stdout.write(
    `${JSON.stringify(
      {
        comparison:
          'Actual current inline replay methods; baseline restores historical fatal response admission, not a full historical binary. Controlled async sink, no native PTYs or network.',
        provenance: { node: process.version, platform: process.platform, arch: process.arch },
        sources,
        baselineSourceHash: hash(baseline),
        historicalVersion: 'v1.4.163',
        historicalSources: Object.fromEntries(
          Object.entries(historical).map(([path, source]) => [path, hash(source)])
        ),
        historicalChecks,
        existingFix: { pr: 17968, commit: '99d9111653d27621b36e00b4e2c79009952a342a' },
        phases
      },
      null,
      2
    )}\n`
  )
} finally {
  if (runnerId) {
    delete require.cache[runnerId]
  }
  await rm(scratch, { recursive: true, force: true })
}
