import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startVitest } from 'vitest/node'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Run with ORCA_BACKGROUND_LAUNCH=1.')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const sources = [
  'src/renderer/src/store/terminals/terminal-tab-creation.ts',
  'src/renderer/src/store/terminals/terminal-tab-close.ts',
  'src/renderer/src/store/terminals/terminal-tab-close-providers.ts',
  'src/renderer/src/lib/workspace-session-patch.ts',
  'src/renderer/src/hooks/ipc-events/mobile-terminal-close-ipc-bridge.ts',
  'src/renderer/src/runtime/sync-runtime-graph.ts',
  'src/renderer/src/runtime/sync-runtime-graph/graph-publication.ts',
  'src/main/persistence/loading-store/session-snapshot-operations.ts',
  'src/main/persistence/loading-store/workspace-session-snapshot-publication.ts',
  'src/main/runtime/workspace-session-terminal-membership-authority.ts',
  'src/main/runtime/mobile-session-terminal-persistence-retirement.ts',
  'src/main/runtime/orca-runtime-close-mobile-session-tab.ts',
  'src/main/runtime/orca-runtime-build-headless-mobile-session-browser-tabs.ts',
  'docs/audits/local-tab-close-rebase/fixture.test.ts'
]
const sourceSha256ByPath = Object.fromEntries(
  await Promise.all(
    sources.map(async (path) => [
      path,
      createHash('sha256')
        .update(await readFile(join(root, path)))
        .digest('hex')
    ])
  )
)
const scratch = await mkdtemp(join(tmpdir(), 'orca-local-close-proof-'))
try {
  const outputPath = join(scratch, 'samples.json')
  const configPath = join(scratch, 'vitest.config.mjs')
  await writeFile(
    configPath,
    `
import base from ${JSON.stringify(pathToFileURL(join(root, 'config/vitest.config.ts')).href)}
export default { ...base, test: { ...base.test,
 include: [${JSON.stringify(join(root, 'docs/audits/local-tab-close-rebase/fixture.test.ts'))}],
 maxWorkers: 1, fileParallelism: false,
 env: { ORCA_LOCAL_TAB_CLOSE_REBASE_OUTPUT: ${JSON.stringify(outputPath)} }
}}
`
  )
  const runner = await startVitest('test', [], {
    root,
    config: configPath,
    watch: false,
    reporters: ['dot']
  })
  assert(runner, 'Vitest did not start')
  const errors = runner.state.getUnhandledErrors()
  await runner.close()
  assert.equal(errors.length, 0, 'Vitest reported unhandled errors')
  const samples = JSON.parse(await readFile(outputPath, 'utf8'))
  assert.equal(samples.length, 6)
  for (const sample of samples) {
    const restored = ['sibling-exited', 'runtime-renderer-late-graph'].includes(sample.scenario)
    assert.equal(sample.rendererHasTab, false)
    assert.equal(sample.patchHasTab, false)
    assert.equal(sample.killRequests, 0)
    assert.deepEqual(sample.closedTombstones, {})
    assert.equal(sample.mainHasTab, restored)
    assert.equal(sample.diskHasTab, restored)
    assert.equal(sample.rehydratedHasTab, restored)
    if (sample.scenario.startsWith('runtime-')) {
      assert.deepEqual(sample.runtimeResult, { closed: true })
    }
  }
  const results = {
    sourceSha256ByPath,
    reportedVersion: 'v1.4.192',
    versionScope:
      'Critical create/close/rebase paths inspected in reported tag; executable proof uses current checkout only.',
    samples
  }
  const output = `${JSON.stringify(results, null, 2)}\n`
  if (process.argv[2]) {
    await writeFile(resolve(process.argv[2]), output)
  }
  process.stdout.write(output)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
