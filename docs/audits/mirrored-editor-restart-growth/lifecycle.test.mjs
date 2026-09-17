import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import {
  createTestStore,
  makeWorktree,
  TEST_REPO
} from '../../../src/renderer/src/store/slices/store-test-helpers'
import { createStoreSessionMockApi } from '../../../src/renderer/src/store/slices/store-session-test-harness'
import { buildWorkspaceSessionPayload } from '../../../src/renderer/src/lib/workspace-session'
import { applyWebSessionTabsSnapshot } from '../../../src/renderer/src/runtime/web-session-tabs-sync'
import { resetWebSessionTabsSyncTestState } from '../../../src/renderer/src/runtime/web-session-tabs-sync-test-harness'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
createStoreSessionMockApi()
const worktree = 'repo-a::/fixture/worktree'
const filePath = '/fixture/worktree/README.md'
const environment = 'peer-a'
const reports = []
const { loadSources } = createRequire(import.meta.url)('./sources.cjs')
const loaded = loadSources()
const historical = process.env.ORCA_10859_VARIANT === 'reported-hydration'
const variant = historical ? 'reported-hydration' : 'current'
const snapshot = {
  worktree,
  publicationEpoch: 'epoch-a',
  snapshotVersion: 1,
  activeGroupId: 'host-group',
  activeTabId: 'host-tab',
  activeTabType: 'editor',
  tabs: [
    {
      type: 'file',
      id: 'host-tab',
      title: 'README.md',
      filePath,
      relativePath: 'README.md',
      language: 'markdown',
      isDirty: false,
      isActive: true
    }
  ]
}

function freshStore() {
  const store = createTestStore()
  store.setState({
    repos: [{ ...TEST_REPO, id: 'repo-a', path: '/fixture/worktree', displayName: 'Fixture' }],
    worktreesByRepo: {
      'repo-a': [makeWorktree({ id: worktree, repoId: 'repo-a', path: '/fixture/worktree' })]
    },
    activeWorktreeId: worktree
  })
  return store
}
function ingest(store, frame = snapshot) {
  const state = store.getState()
  store.setState(applyWebSessionTabsSnapshot(state, frame, environment, 1700000000000))
}
function persist(store) {
  return JSON.parse(JSON.stringify(buildWorkspaceSessionPayload(store.getState())))
}
function restart(store) {
  const session = persist(store)
  resetWebSessionTabsSyncTestState()
  const next = freshStore()
  next.getState().hydrateTabsSession(session)
  next.getState().hydrateEditorSession(session)
  return next
}
function record(store) {
  const state = store.getState()
  return {
    rows: state.openFiles.length,
    ids: state.openFiles.map((file) => file.id),
    dirty: state.openFiles.filter((file) => file.isDirty).map((file) => file.id),
    drafts: { ...state.editorDrafts },
    unified: (state.unifiedTabsByWorktree[worktree] ?? []).map((tab) => ({
      id: tab.id,
      entityId: tab.entityId
    }))
  }
}
beforeEach(() => {
  expect(process.env.ORCA_BACKGROUND_LAUNCH).toBe('1')
  resetWebSessionTabsSyncTestState()
  vi.clearAllMocks()
})
afterAll(() => {
  const artifactNames = [
    'sources.cjs',
    'vitest.config.mjs',
    'lifecycle.test.mjs',
    'source-versions.json',
    'reported-projection.json',
    'reported-hydration-module.txt',
    'reported-hydration-ids.txt',
    'reported-hydration-method.txt'
  ]
  const artifactHashes = Object.fromEntries(
    artifactNames.map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n'))
        .digest('hex')
    ])
  )
  writeFileSync(
    process.env.ORCA_EDITOR_RESTART_OUTPUT ??
      new URL(
        `${variant}-${process.versions.electron ? 'electron' : 'node'}-results.json`,
        import.meta.url
      ),
    `${JSON.stringify({ variant, runtime: process.versions, sources: loaded.hashes, fixtureHashes: loaded.fixtureHashes, artifactHashes, cases: reports }, null, 2)}\n`
  )
})

it('compares eight unchanged snapshots with eight full store persistence and hydration cycles', () => {
  const live = freshStore()
  const liveRows = []
  for (let cycle = 0; cycle < 8; cycle++) {
    ingest(live)
    liveRows.push(live.getState().openFiles.length)
  }
  let store = freshStore()
  const restartedRows = []
  const hydratedRows = []
  for (let cycle = 0; cycle < 8; cycle++) {
    ingest(store)
    restartedRows.push(store.getState().openFiles.length)
    store = restart(store)
    hydratedRows.push(store.getState().openFiles.length)
  }
  expect(liveRows).toEqual(Array(8).fill(1))
  expect(restartedRows).toEqual(historical ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 2, 2, 2, 2, 2, 2])
  expect(hydratedRows).toEqual(historical ? [1, 2, 3, 4, 5, 6, 7, 8] : Array(8).fill(1))
  reports.push({
    kind: 'restart-growth',
    liveRows,
    restartedRows,
    hydratedRows,
    final: record(store)
  })
})

it('observes a pre-restart draft behind a new clean mirrored tab', () => {
  let store = freshStore()
  ingest(store)
  store.getState().setEditorDraft(filePath, 'unsaved original draft')
  store.getState().markFileDirty(filePath, true)
  store = restart(store)
  const before = record(store)
  ingest(store)
  const after = record(store)
  expect(after.rows).toBe(2)
  expect(Object.values(after.drafts)).toEqual(['unsaved original draft'])
  expect(after.unified).toEqual([{ id: 'host-tab', entityId: filePath }])
  expect(after.dirty).not.toContain(filePath)
  reports.push({ kind: 'existing-draft-behind-mirror', before, after })
})

it('observes editing the visible post-restart mirror before another restart', () => {
  let store = freshStore()
  ingest(store)
  store = restart(store)
  ingest(store)
  store.getState().setEditorDraft(filePath, 'new draft in visible mirror')
  store.getState().markFileDirty(filePath, true)
  const before = record(store)
  const serialized = persist(store)
  expect(
    serialized.openFilesByWorktree[worktree].some(
      (file) => file.dirtyDraftContent === 'new draft in visible mirror'
    )
  ).toBe(true)
  store = restart(store)
  const after = record(store)
  expect(after.rows).toBe(historical ? 2 : 1)
  expect(Object.values(after.drafts)).toEqual(historical ? ['new draft in visible mirror'] : [])
  reports.push({
    kind: 'later-visible-draft-restore',
    before,
    serialized: serialized.openFilesByWorktree[worktree],
    after
  })
})

it('keeps a local same-path owner separate while current remote duplicates stay bounded', () => {
  let store = freshStore()
  store.getState().openFile({
    filePath,
    relativePath: 'README.md',
    worktreeId: worktree,
    language: 'markdown',
    mode: 'edit'
  })
  const rows = []
  for (let cycle = 0; cycle < 8; cycle++) {
    ingest(store)
    rows.push(store.getState().openFiles.length)
    expect(store.getState().openFiles.some((file) => !file.runtimeEnvironmentId)).toBe(true)
    store = restart(store)
  }
  expect(rows).toEqual(historical ? [2, 3, 4, 5, 6, 7, 8, 9] : [2, 3, 3, 3, 3, 3, 3, 3])
  reports.push({ kind: 'local-owner-isolation', rows, final: record(store) })
})

it('fences both variants identically with synthetic CRLF source reads', () => {
  let reads = 0
  for (const sourceVariant of ['current', 'reported-hydration']) {
    const ordinary = loadSources({ variant: sourceVariant })
    const canonical = loadSources({
      variant: sourceVariant,
      read(filename) {
        reads += 1
        return readFileSync(filename, 'utf8').replace(/\r?\n/g, '\r\n')
      }
    })
    expect(canonical.hashes).toEqual(ordinary.hashes)
    expect(canonical.fixtureHashes).toEqual(ordinary.fixtureHashes)
    expect([...canonical.sources]).toEqual([...ordinary.sources])
  }
  reports.push({ kind: 'canonical-crlf-source-control', reads, variants: 2 })
})
