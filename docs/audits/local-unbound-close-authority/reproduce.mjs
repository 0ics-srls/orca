import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Run with ORCA_BACKGROUND_LAUNCH=1.')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const artifact = 'docs/audits/local-unbound-close-authority'
const paths = [
  'src/shared/closed-terminal-tab-tombstones.ts',
  'src/shared/terminal-tab-types.ts',
  'src/shared/workspace-session-schema.ts',
  'src/shared/workspace-session-terminal-tab-close.ts',
  'src/main/runtime/workspace-session-terminal-membership-authority.ts',
  'src/main/runtime/mobile-session-terminal-persistence-retirement.ts',
  'src/main/persistence/loading-store/workspace-session-snapshot-publication.ts',
  'src/main/persistence/loading-store/terminal-session-cleanup.ts',
  'src/renderer/src/store/terminals/terminal-tab-close.ts',
  ...['candidate.ts', 'receipt-candidate.ts', 'candidate.config.mjs', 'ownership.test.ts'].map(
    (path) => `${artifact}/${path}`
  )
]
const sourceHashes = Object.fromEntries(
  await Promise.all(
    paths.map(async (path) => [
      path,
      createHash('sha256')
        .update(await readFile(resolve(root, path)))
        .digest('hex')
    ])
  )
)
const scratch = await mkdtemp(join(tmpdir(), 'orca-empty-close-authority-'))
const require = createRequire(import.meta.url)
let runnerModuleId
try {
  const runnerPath = join(scratch, 'run-process.cjs')
  await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, 'src/shared/child-process/run-process.ts')],
    outfile: runnerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent'
  })
  runnerModuleId = require.resolve(runnerPath)
  const { runProcess } = require(runnerModuleId)
  const cases = [
    { name: 'baseline21', candidate: '0', receipt: '0', clock: '0', passed: 13, failed: 8 },
    { name: 'candidate21', candidate: '1', receipt: '0', clock: '0', passed: 20, failed: 1 },
    { name: 'receipt27', candidate: '1', receipt: '1', clock: '0', passed: 27, failed: 0 },
    { name: 'clock30', candidate: '1', receipt: '1', clock: '1', passed: 27, failed: 3 }
  ]
  const phases = {}
  for (const phase of cases) {
    const report = join(scratch, `${phase.name}.json`)
    const processResult = await runProcess({
      program: process.execPath,
      args: [
        resolve(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        resolve(root, artifact, 'candidate.config.mjs'),
        '--reporter=json',
        `--outputFile=${report}`
      ],
      cwd: root,
      env: {
        ...process.env,
        ORCA_UNBOUND_CANDIDATE: phase.candidate,
        ORCA_UNBOUND_RECEIPT: phase.receipt,
        ORCA_UNBOUND_CLOCK_CASES: phase.clock
      },
      timeoutMs: 90_000,
      maxOutputBytes: 4 * 1024 * 1024
    })
    const result = JSON.parse(await readFile(report, 'utf8'))
    phases[phase.name] = {
      total: result.numTotalTests,
      passed: result.numPassedTests,
      failed: result.numFailedTests,
      exitCode: processResult.code,
      timedOut: processResult.timedOut,
      failedCases: result.testResults.flatMap((suite) =>
        suite.assertionResults
          .filter((test) => test.status === 'failed')
          .map((test) => test.fullName)
      )
    }
    assert.equal(processResult.timedOut, false, `${phase.name} timed out`)
    assert.equal(
      processResult.code,
      phase.failed === 0 ? 0 : 1,
      `${phase.name} unexpected process exit`
    )
    assert.equal(
      result.numTotalTests,
      phase.passed + phase.failed,
      `${phase.name} case count drifted`
    )
    assert.equal(result.numPassedTests, phase.passed, `${phase.name} pass count drifted`)
    assert.equal(result.numFailedTests, phase.failed, `${phase.name} failure count drifted`)
  }
  const output = {
    comparison:
      'Actual renderer close and Store persistence. Intentionally unsafe candidate overlays; no product edits.',
    sourceHashes,
    phases,
    expectedFailuresReproduced: true
  }
  await writeFile(resolve(root, artifact, 'results.json'), `${JSON.stringify(output, null, 2)}\n`)
  console.log(JSON.stringify(phases, null, 2))
} finally {
  if (runnerModuleId) {
    delete require.cache[runnerModuleId]
  }
  await rm(scratch, { recursive: true, force: true })
}
