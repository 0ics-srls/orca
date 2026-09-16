import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startVitest } from 'vitest/node'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Run with ORCA_BACKGROUND_LAUNCH=1.')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const directory = import.meta.dirname
const transforms = JSON.parse(await readFile(join(directory, 'candidate-transforms.json'), 'utf8'))
const replacements = {}
const sourceHashes = {}
for (const transform of transforms) {
  const source = await readFile(join(root, transform.path), 'utf8')
  const sha256 = createHash('sha256').update(source).digest('hex')
  assert.equal(sha256, transform.sha256, `Review the candidate transform for ${transform.path}`)
  let candidate = source
  for (const change of transform.changes) {
    assert.equal(candidate.split(change.before).length, 2, 'Candidate anchor is not unique')
    candidate = candidate.replace(change.before, change.after)
  }
  replacements[`/${transform.path}`] = candidate
  sourceHashes[transform.path] = {
    baseline: sha256,
    candidate: createHash('sha256').update(candidate).digest('hex')
  }
}
const scratch = await mkdtemp(join(tmpdir(), 'orca-daemon-stop-authority-'))
const priorVariant = process.env.ORCA_DAEMON_STOP_VARIANT
const priorResults = process.env.ORCA_DAEMON_STOP_RESULTS
const phases = []
try {
  for (const phase of ['baseline', 'candidate']) {
    const results = join(scratch, phase)
    await mkdir(results)
    process.env.ORCA_DAEMON_STOP_VARIANT = phase
    process.env.ORCA_DAEMON_STOP_RESULTS = results
    const configPath = join(scratch, `${phase}.config.mjs`)
    await writeFile(
      configPath,
      `
import base from ${JSON.stringify(pathToFileURL(join(root, 'config/vitest.config.ts')).href)}
const replacements = ${JSON.stringify(phase === 'candidate' ? replacements : {})}
export default {
  ...base,
  plugins: [{ name: 'unshipped-stop-authority', enforce: 'pre', transform(code, id) {
    for (const [path, replacement] of Object.entries(replacements)) {
      if (id.replaceAll('\\\\', '/').endsWith(path)) return replacement
    }
  } }],
  test: {
    ...base.test,
    include: ${JSON.stringify([join(directory, 'authority.test.ts'), join(directory, 'shutdown-gap.test.ts')])},
    maxWorkers: 1, fileParallelism: false
  }
}
`
    )
    const runner = await startVitest('test', [], {
      root,
      config: configPath,
      watch: false,
      reporters: ['dot']
    })
    assert(runner, 'Vitest did not start')
    await runner.close()
    const verification = JSON.parse(await readFile(join(results, 'authority.json'), 'utf8'))
    const reconnectGap = JSON.parse(await readFile(join(results, 'shutdown-gap.json'), 'utf8'))
    const unknownOwnerGap = JSON.parse(
      await readFile(join(results, 'unknown-owner-gap.json'), 'utf8')
    )
    const sameDaemonGap = JSON.parse(await readFile(join(results, 'same-daemon-gap.json'), 'utf8'))
    assert.equal(sameDaemonGap.stopped, true)
    assert.equal(sameDaemonGap.daemonIdentityChanged, false)
    assert.equal(sameDaemonGap.replacementIncarnationChanged, true)
    assert.equal(sameDaemonGap.replacementForceKills, 1)
    assert.equal(verification.length, 8)
    assert.equal(reconnectGap.stopped, phase === 'baseline')
    assert.equal(reconnectGap.replacementForceKills, 1)
    assert.equal(reconnectGap.daemonIdentityChanged, true)
    assert.equal(reconnectGap.replacementIncarnationChanged, true)
    assert.equal(reconnectGap.remainingProcesses, 0)
    assert.equal(unknownOwnerGap.stopped, false)
    assert.equal(unknownOwnerGap.wrongCurrentForceKills, 1)
    assert.equal(unknownOwnerGap.intendedLegacyRemaining, 1)
    for (const row of verification) {
      delete row.state.incarnationId
    }
    phases.push({ phase, verification, reconnectGap, unknownOwnerGap, sameDaemonGap })
  }
  for (const name of ['authority.test.ts', 'shutdown-gap.test.ts']) {
    sourceHashes[name] = createHash('sha256')
      .update(await readFile(join(directory, name)))
      .digest('hex')
  }
  const output = `${JSON.stringify({ sourceHashes, phases }, null, 2)}\n`
  if (process.argv[2]) {
    await writeFile(resolve(process.argv[2]), output)
  }
  process.stdout.write(output)
} finally {
  if (priorVariant === undefined) {
    delete process.env.ORCA_DAEMON_STOP_VARIANT
  } else {
    process.env.ORCA_DAEMON_STOP_VARIANT = priorVariant
  }
  if (priorResults === undefined) {
    delete process.env.ORCA_DAEMON_STOP_RESULTS
  } else {
    process.env.ORCA_DAEMON_STOP_RESULTS = priorResults
  }
  await rm(scratch, { recursive: true, force: true })
}
