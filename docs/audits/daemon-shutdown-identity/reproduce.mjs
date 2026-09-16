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
const transforms = [JSON.parse(await readFile(join(directory, 'candidate-transform.json'), 'utf8'))]
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
const scratch = await mkdtemp(join(tmpdir(), 'orca-daemon-shutdown-identity-'))
const priorVariant = process.env.ORCA_SHUTDOWN_IDENTITY_VARIANT
const priorResults = process.env.ORCA_DAEMON_IDENTITY_RESULTS
const phases = []
try {
  for (const phase of ['baseline', 'candidate']) {
    const results = join(scratch, phase)
    await mkdir(results)
    process.env.ORCA_SHUTDOWN_IDENTITY_VARIANT = phase
    process.env.ORCA_DAEMON_IDENTITY_RESULTS = results
    const configPath = join(scratch, `${phase}.config.mjs`)
    await writeFile(
      configPath,
      `
import base from ${JSON.stringify(pathToFileURL(join(root, 'config/vitest.config.ts')).href)}
const replacements = ${JSON.stringify(phase === 'candidate' ? replacements : {})}
export default {
  ...base,
  plugins: [{ name: 'unshipped-shutdown-identity', enforce: 'pre', transform(code, id) {
    for (const [path, replacement] of Object.entries(replacements)) {
      if (id.replaceAll('\\\\', '/').endsWith(path)) return replacement
    }
  } }],
  test: {
    ...base.test,
    include: ${JSON.stringify([join(directory, 'adapter.test.ts'), join(directory, 'close-retry.test.ts')])},
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
    const adapter = JSON.parse(await readFile(join(results, 'adapter.json'), 'utf8'))
    const closeRetry = JSON.parse(await readFile(join(results, 'close-retry.json'), 'utf8'))
    assert.equal(adapter.length, 8)
    for (const row of adapter) {
      const refuses = phase === 'candidate' && row.scenario.startsWith('restart-')
      assert.equal(row.result.status, refuses ? 'rejected' : 'fulfilled')
      assert.equal(row.remaining, refuses ? 1 : 0)
      if (row.replacementIncarnationChanged) {
        assert.equal(row.replacementForceKills, refuses ? 0 : 1)
      }
    }
    assert.equal(closeRetry.close.ptyKilled, phase === 'baseline')
    assert.equal(closeRetry.fallbackKills, phase === 'candidate' ? 1 : 0)
    assert.equal(closeRetry.forceKills, phase === 'candidate' ? 0 : 1)
    assert.equal(closeRetry.gracefulKills, phase === 'candidate' ? 1 : 0)
    assert.equal(closeRetry.remaining, 0)
    assert.equal(closeRetry.identityRefusal, phase === 'candidate')
    phases.push({ phase, adapter, closeRetry })
  }
  for (const name of ['adapter.test.ts', 'close-retry.test.ts']) {
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
    delete process.env.ORCA_SHUTDOWN_IDENTITY_VARIANT
  } else {
    process.env.ORCA_SHUTDOWN_IDENTITY_VARIANT = priorVariant
  }
  if (priorResults === undefined) {
    delete process.env.ORCA_DAEMON_IDENTITY_RESULTS
  } else {
    process.env.ORCA_DAEMON_IDENTITY_RESULTS = priorResults
  }
  await rm(scratch, { recursive: true, force: true })
}
