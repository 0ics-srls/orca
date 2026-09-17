import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  store: null,
  request: null,
  replyListeners: new Set(),
  catalogHandlers: new Map(),
  catalogRows: [],
  nextId: 0,
  webContents: null
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name, handler) => fixture.catalogHandlers.set(name, handler) }
}))
vi.mock(
  '../../../src/main/ipc/worktrees/listing/detected-worktree-scan-cache',
  async (importOriginal) => ({
    ...(await importOriginal()),
    listDetectedGitWorktrees: async () => ({ gitWorktrees: fixture.catalogRows, fresh: false })
  })
)

vi.mock('../../../src/renderer/src/store', () => ({
  useAppStore: { getState: () => fixture.store.getState() }
}))
vi.mock('../../../src/renderer/src/lib/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: () => {}
}))
vi.mock('../../../src/renderer/src/runtime/sync-runtime-graph', () => ({
  focusRuntimeTerminalSurface: () => false
}))
vi.mock('../../../src/main/runtime/orca-runtime-wait-for-mobile-terminal-surface', () => ({
  OrcaRuntimeWithWaitForMobileTerminalSurface: class {}
}))
vi.mock('../../../src/main/runtime/orca-runtime-transition-graph-reload-to-terminal-state', () => ({
  OrcaRuntimeWithTransitionGraphReloadToTerminalState: class {}
}))
vi.mock('../../../src/main/runtime/orca-runtime-create-agent-session', () => ({
  OrcaRuntimeWithCreateAgentSession: class {}
}))
vi.mock('../../../src/main/runtime/orca-runtime-create-terminal-dependencies', async () => ({
  resolveTerminalPresentation: (await import('../../../src/main/runtime/orca-runtime-core'))
    .resolveTerminalPresentation,
  randomUUID: () => `request-${++fixture.nextId}`,
  ownerSurfacing: (surfaceOwner) => ({ surfaceOwner }),
  getRuntimeDesktopSurface: () => ({
    onIpc: (_name, fn) => fixture.replyListeners.add(fn),
    removeIpcListener: (_name, fn) => fixture.replyListeners.delete(fn)
  })
}))

import {
  createTestStore,
  makeWorktree,
  seedStore
} from '../../../src/renderer/src/store/slices/store-test-helpers'
import { registerTerminalRequestIpcBridge } from '../../../src/renderer/src/hooks/ipc-events/terminal-request-ipc-bridge'
import { projectWorkspaceSurfaces } from '../../../src/renderer/src/components/workspace-surface-projection'
import { resolveTerminalWorktreeRoute } from '../../../src/renderer/src/lib/terminal-worktree-route'
import { takeAllPendingBackgroundTerminalWorktreeMounts } from '../../../src/renderer/src/components/terminal/background-terminal-worktree-mount'
import { OrcaRuntimeWithCreateTerminal } from '../../../src/main/runtime/orca-runtime-create-terminal'
import { OrcaRuntimeWithTerminalCreateDeduplication } from '../../../src/main/runtime/orca-runtime-terminal-create-deduplication'
import { TERMINAL_LIFECYCLE_METHODS } from '../../../src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods'
import { OrcaRuntimeWithResolveWorktreeSelector } from '../../../src/main/runtime/orca-runtime-resolve-worktree-selector'
import { OrcaRuntimeWithResolveBrowserNetworkExecutionHostForWorktree } from '../../../src/main/runtime/orca-runtime-resolve-browser-network-execution-host-for-worktree'
import {
  resolveScopedWorktreeIdRow,
  resolveRepoWorktreeRows
} from '../../../src/main/runtime/repo-worktree-row-resolution'
import { shouldUseRendererBackedInteractiveTerminal } from '../../../src/cli/codex-command-classification'
import { registerWorktreeCatalogHandlers } from '../../../src/main/ipc/worktrees/listing/register-worktree-catalog-handlers'
import { buildDetectedGitWorktrees } from '../../../src/main/ipc/worktrees/listing/ssh-worktree-fallback'
import { mergeFetchedWorktrees } from '../../../src/renderer/src/store/slices/worktrees/listing/fetched-worktree-merge'
import { OrcaRuntimeWithRestoreLivePairedRendererSessionOwnedMobileTerminals } from '../../../src/main/runtime/orca-runtime-restore-live-paired-renderer-session-owned-mobile-terminals'

const WORKTREE = 'repo1::/tmp/never-listed'
const COMMAND = '/not-installed/claude'
let runtime
let unsubscribers
let mainRows
let mainRepo
let mainDeps

function surfaces() {
  const state = fixture.store.getState()
  return projectWorkspaceSurfaces({
    worktreesById: new Map(
      Object.values(state.worktreesByRepo)
        .flat()
        .map((row) => [row.id, row])
    ),
    folderWorkspaces: state.folderWorkspaces,
    activeWorkspaceId: state.activeWorktreeId,
    activeWorkspaceResolvedHostId: null
  })
}

async function create(presentation = 'focused') {
  const method = TERMINAL_LIFECYCLE_METHODS.find((method) => method.name === 'terminal.create')
  const response = await method.handler(
    {
      worktree: `id:${WORKTREE}`,
      command: COMMAND,
      rendererBacked: shouldUseRendererBackedInteractiveTerminal(COMMAND),
      presentation,
      focus: presentation === 'focused'
    },
    { runtime, clientId: 'fixture-cli' }
  )
  return response.terminal
}

function counts() {
  const state = fixture.store.getState()
  return {
    tabs: state.tabsByWorktree[WORKTREE]?.length ?? 0,
    unified: state.unifiedTabsByWorktree[WORKTREE]?.length ?? 0,
    pending: Object.keys(state.pendingStartupByTabId).length,
    surfaces: surfaces().length,
    waiters: runtime.graphSyncCallbacks.length,
    replyListeners: fixture.replyListeners.size
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  fixture.nextId = 0
  fixture.replyListeners.clear()
  fixture.catalogHandlers.clear()
  fixture.store = createTestStore()
  seedStore(fixture.store, {
    runtimeEnvironmentCatalogHydrated: true,
    runtimeEnvironments: [],
    worktreesByRepo: {},
    detectedWorktreesByRepo: {},
    folderWorkspaces: [],
    refreshGitHubForWorktreeIfStale: () => {},
    recordFeatureInteraction: () => {}
  })
  fixture.webContents = {
    send: (name, data) => {
      expect(name).toBe('terminal:requestTabCreate')
      fixture.request(data)
    }
  }
  mainRepo = {
    id: 'repo1',
    path: '/tmp/repo1',
    displayName: 'Repo 1',
    executionHostId: 'local',
    addedAt: 0
  }
  mainRows = [
    {
      path: '/tmp/never-listed',
      head: 'abc123',
      branch: 'refs/heads/work',
      isBare: false,
      isMainWorktree: false
    }
  ]
  const metadata = {}
  const mainStore = {
    getRepos: () => [mainRepo],
    getRepo: () => mainRepo,
    getWorktreeMeta: (id) => metadata[id],
    getAllWorktreeMeta: () => metadata,
    getAllWorktreeLineage: () => ({}),
    getProjects: () => [],
    getProjectHostSetups: () => [],
    getSettings: () => ({}),
    setWorktreeMeta: (id, update) => (metadata[id] = { ...metadata[id], ...update })
  }
  mainDeps = {
    store: mainStore,
    scanRepo: async () => ({ ok: true, worktrees: mainRows }),
    listFolderWorkspaces: () => []
  }
  window.api = {
    ui: {
      onRequestTerminalCreate: (fn) => {
        fixture.request = fn
        return () => {
          fixture.request = null
        }
      },
      replyTerminalCreate: (reply) => {
        for (const fn of fixture.replyListeners) {
          fn({ sender: fixture.webContents }, reply)
        }
      }
    }
  }
  runtime = Object.create(
    OrcaRuntimeWithRestoreLivePairedRendererSessionOwnedMobileTerminals.prototype
  )
  Object.assign(runtime, {
    graphSyncCallbacks: [],
    handles: new Map(),
    resolvedHandles: new Map(),
    assertGraphReady: () => {},
    getAuthoritativeWindow: () => ({ webContents: fixture.webContents }),
    getAvailableAuthoritativeWindow: () => ({ webContents: fixture.webContents }),
    createTerminal: OrcaRuntimeWithCreateTerminal.prototype.createTerminal,
    dedupeTerminalCreate: OrcaRuntimeWithTerminalCreateDeduplication.prototype.dedupeTerminalCreate,
    store: mainStore,
    resolveFolderWorkspaceLaunchScope: async () => null,
    hasFreshResolvedWorktreeCache: () => false,
    resolveExplicitWorktreeIdScoped: (id) => resolveScopedWorktreeIdRow(mainDeps, id),
    listResolvedWorktrees: () => resolveRepoWorktreeRows(mainDeps, mainRepo, metadata, new Map()),
    resolveAgentTerminalCreateOptions: async (_scope, opts) => opts,
    resolveWorkspaceTerminalStartupCwd: (scope) => scope.path,
    resolveHandleForTab(tabId) {
      return this.resolvedHandles.get(tabId) ?? null
    },
    getPtyExecutionHostMetadata: () => ({ executionHostId: 'local' })
  })
  for (const key of [
    'resolveTerminalWorkspaceLaunchScope',
    'resolveTerminalWorkspaceLaunchTarget',
    'getValidatedExplicitWorktreeIdSelector'
  ]) {
    runtime[key] = OrcaRuntimeWithResolveBrowserNetworkExecutionHostForWorktree.prototype[key]
  }
  for (const key of ['resolveWorktreeSelector', 'buildResolvedWorktreeFromId']) {
    runtime[key] = OrcaRuntimeWithResolveWorktreeSelector.prototype[key]
  }
  unsubscribers = []
  registerTerminalRequestIpcBridge(unsubscribers)
})

afterEach(() => {
  for (const unsubscribe of unsubscribers) {
    unsubscribe()
  }
  takeAllPendingBackgroundTerminalWorktreeMounts()
  vi.clearAllTimers()
  vi.useRealTimers()
  delete window.api
  vi.restoreAllMocks()
})

describe('issue18224 actual renderer bridge/store and desktop handle wait', () => {
  it.each(['focused', 'background'])(
    '%s never-listed creates survive wait timeout',
    async (presentation) => {
      expect(resolveTerminalWorktreeRoute(fixture.store.getState(), WORKTREE)).toEqual({
        runtimeEnvironmentId: null
      })
      for (let index = 0; index < 8; index += 1) {
        const result = create(presentation).catch((error) => error.message)
        await vi.advanceTimersByTimeAsync(10_001)
        expect(await result).toBe('Timed out waiting for terminal handle after creation')
      }
      expect(counts()).toEqual({
        tabs: 8,
        unified: 8,
        pending: 8,
        surfaces: 0,
        waiters: 0,
        replyListeners: 0
      })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(counts().pending).toBe(8)
      for (const tab of fixture.store.getState().tabsByWorktree[WORKTREE]) {
        fixture.store.getState().closeTab(tab.id)
      }
      expect(counts()).toEqual({
        tabs: 0,
        unified: 0,
        pending: 0,
        surfaces: 0,
        waiters: 0,
        replyListeners: 0
      })
    }
  )

  it('keeps the late mount intent after timeout and makes it eligible when the catalog arrives', async () => {
    const result = create().catch((error) => error.message)
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await result).toContain('Timed out waiting')
    const tab = fixture.store.getState().tabsByWorktree[WORKTREE][0]
    fixture.store.setState({
      worktreesByRepo: {
        repo1: [makeWorktree({ id: WORKTREE, repoId: 'repo1', path: '/tmp/never-listed' })]
      }
    })
    expect(surfaces()).toEqual([{ id: WORKTREE, path: '/tmp/never-listed' }])
    expect(fixture.store.getState().pendingStartupByTabId[tab.id]).toMatchObject({
      command: COMMAND
    })
    expect(fixture.store.getState().consumeTabStartupCommand(tab.id)).toMatchObject({
      command: COMMAND
    })
    expect(counts().pending).toBe(0)
  })

  it('settles an ordinary handle published before the deadline', async () => {
    const result = create()
    await vi.advanceTimersByTimeAsync(1)
    const tab = fixture.store.getState().tabsByWorktree[WORKTREE][0]
    runtime.resolvedHandles.set(tab.id, 'test-handle')
    const callbacks = runtime.graphSyncCallbacks.slice()
    for (const notify of callbacks) {
      notify()
    }
    expect(await result).toMatchObject({ tabId: tab.id, handle: 'test-handle' })
    expect(runtime.graphSyncCallbacks).toHaveLength(0)
    expect(fixture.replyListeners.size).toBe(0)
  })

  it('rejects an unknown repo before creating any tab or startup intent', async () => {
    fixture.store.setState({ repos: [] })
    await expect(create()).rejects.toThrow('worktree owner could not be resolved')
    expect(counts()).toEqual({
      tabs: 0,
      unified: 0,
      pending: 0,
      surfaces: 0,
      waiters: 0,
      replyListeners: 0
    })
  })

  it('refuses stale local metadata when no actual main catalog row resolves', async () => {
    mainRows = []
    runtime.store.setWorktreeMeta(WORKTREE, { displayName: 'old row' })
    await expect(create()).rejects.toThrow('selector_not_found')
    expect(counts().tabs).toBe(0)
  })

  it('still reaches the renderer via saved SSH metadata when the scan has no row', async () => {
    mainRows = []
    mainRepo.connectionId = 'fixture-ssh'
    mainRepo.executionHostId = 'ssh:fixture-ssh'
    runtime.store.setWorktreeMeta(WORKTREE, {
      displayName: 'remote row',
      hostId: 'ssh:fixture-ssh'
    })
    fixture.store.setState({ repos: [mainRepo] })
    const result = create().catch((error) => error.message)
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await result).toContain('Timed out waiting')
    expect(counts().tabs).toBe(1)
    expect(counts().surfaces).toBe(0)
  })

  it('ordinary external-worktree visibility hides the surface while the same Git rows remain launchable', async () => {
    const warn = vi.spyOn(console, 'warn')
    mainRepo.externalWorktreeVisibility = 'hide'
    mainRepo.externalWorktreeVisibilityLegacy = false
    runtime.store.getSettings = () => ({
      workspaceDir: '/tmp/orca/workspaces',
      nestWorkspaces: true
    })
    fixture.catalogRows = mainRows
    registerWorktreeCatalogHandlers({ store: runtime.store })
    const listCatalog = fixture.catalogHandlers.get('worktrees:listAll')
    expect(await listCatalog()).toEqual([])
    fixture.store.setState({ repos: [mainRepo], worktreesByRepo: { repo1: await listCatalog() } })
    expect(await runtime.resolveTerminalWorkspaceLaunchScope(`id:${WORKTREE}`)).toMatchObject({
      id: WORKTREE
    })
    const result = create().catch((error) => error.message)
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await result).toContain('Timed out waiting')
    expect(await listCatalog()).toEqual([])
    expect(counts()).toEqual({
      tabs: 1,
      unified: 1,
      pending: 1,
      surfaces: 0,
      waiters: 0,
      replyListeners: 0
    })
    const detected = buildDetectedGitWorktrees(runtime.store, mainRepo, mainRows)
    expect(detected).toHaveLength(1)
    expect(detected[0].visible).toBe(false)
    expect(
      mergeFetchedWorktrees(fixture.store.setState, {
        repoId: 'repo1',
        hostId: 'local',
        ownerWasMissingAtStart: false,
        requestStartedWorktrees: fixture.store.getState().worktreesByRepo.repo1,
        refresh: {
          status: 'admitted',
          executionHostId: 'local',
          result: { repoId: 'repo1', authoritative: true, source: 'git', worktrees: detected }
        }
      })
    ).toBe(true)
    expect(counts()).toEqual({
      tabs: 1,
      unified: 1,
      pending: 1,
      surfaces: 0,
      waiters: 0,
      replyListeners: 0
    })
    mainRepo.externalWorktreeVisibility = 'show'
    const visible = await listCatalog()
    expect(visible).toHaveLength(1)
    fixture.store.setState({ worktreesByRepo: { repo1: visible } })
    expect(surfaces()).toEqual([{ id: WORKTREE, path: '/tmp/never-listed' }])
    expect(counts().pending).toBe(1)
    expect(warn).not.toHaveBeenCalled()
  })
})
