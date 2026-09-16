import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../store/types'
import {
  buildMobileSessionTabSnapshots,
  registerRuntimeTerminalTab,
  resetRuntimeMobileSyncProjectionCachesForTests
} from './sync-runtime-graph'
import { collectAmbiguousTerminalTabIds, graphState } from './sync-runtime-graph/graph-state'
import { buildMobileSessionAgentStatusByWorktree } from './sync-runtime-graph/mobile-session-inputs'

/**
 * Why operation counts and not wall clock: these memos exist to stop whole-store scans on a path
 * that republishes ~1,200 times during sustained agent output. A threshold in milliseconds would
 * track the test machine; counting the per-tab reads each scan performs does not.
 */

const PUBLICATIONS = 25
const WORKTREES = 300
/** `parsePaneKey` only resolves a pane key whose leaf segment is a real terminal leaf id. */
const STATUS_LEAF_ID = 'dddddddd-1111-4111-8111-111111111111'

/** `tab.id` is read only while a scan walks the tabs, so its read count is the rebuild counter. */
function makeCountingTabs(worktreeCount: number): {
  tabsByWorktree: AppState['tabsByWorktree']
  idReads: () => number
  resetIdReads: () => void
} {
  let idReads = 0
  const tabsByWorktree: Record<string, unknown[]> = {}
  for (let index = 0; index < worktreeCount; index += 1) {
    tabsByWorktree[`repo::/memo-wt-${index}`] = [
      {
        get id() {
          idReads += 1
          return `memo-term-${index}`
        },
        title: `Agent ${index}`,
        customTitle: null,
        ptyId: null
      }
    ]
  }
  return {
    tabsByWorktree: tabsByWorktree as AppState['tabsByWorktree'],
    idReads: () => idReads,
    resetIdReads: () => {
      idReads = 0
    }
  }
}

beforeEach(() => {
  resetRuntimeMobileSyncProjectionCachesForTests()
})

describe('ambiguous terminal tab id memoization', () => {
  it('scans the tabs once across many publications with an unchanged slice', () => {
    const { tabsByWorktree, idReads, resetIdReads } = makeCountingTabs(WORKTREES)

    collectAmbiguousTerminalTabIds(tabsByWorktree)
    expect(idReads()).toBeGreaterThan(0)
    resetIdReads()

    for (let publication = 0; publication < PUBLICATIONS; publication += 1) {
      collectAmbiguousTerminalTabIds(tabsByWorktree)
    }

    expect(idReads()).toBe(0)
  })

  it('rescans when the tabs slice is replaced', () => {
    const { tabsByWorktree, idReads, resetIdReads } = makeCountingTabs(WORKTREES)

    collectAmbiguousTerminalTabIds(tabsByWorktree)
    const firstScanReads = idReads()
    resetIdReads()

    // A copy-on-write replacement is what every tab writer produces; the memo must not survive it.
    collectAmbiguousTerminalTabIds({ ...tabsByWorktree })

    expect(idReads()).toBe(firstScanReads)
  })

  it('reports a duplicate id introduced by a replacement slice', () => {
    const { tabsByWorktree } = makeCountingTabs(2)

    expect([...collectAmbiguousTerminalTabIds(tabsByWorktree)]).toEqual([])
    const duplicated = {
      ...tabsByWorktree,
      'repo::/memo-wt-1': [{ id: 'memo-term-0', title: 'Clone', customTitle: null, ptyId: null }]
    } as AppState['tabsByWorktree']

    expect([...collectAmbiguousTerminalTabIds(duplicated)]).toEqual(['memo-term-0'])
  })
})

describe('mobile session agent status grouping memoization', () => {
  const statusPaneKey = `memo-term-7:${STATUS_LEAF_ID}`
  const agentStatusByPaneKey = {
    [statusPaneKey]: { state: 'working', paneKey: statusPaneKey }
  } as unknown as AppState['agentStatusByPaneKey']

  it('builds the tab index once across many publications with unchanged slices', () => {
    const { tabsByWorktree, idReads, resetIdReads } = makeCountingTabs(WORKTREES)

    buildMobileSessionAgentStatusByWorktree(agentStatusByPaneKey, tabsByWorktree)
    expect(idReads()).toBeGreaterThan(0)
    resetIdReads()

    for (let publication = 0; publication < PUBLICATIONS; publication += 1) {
      buildMobileSessionAgentStatusByWorktree(agentStatusByPaneKey, tabsByWorktree)
    }

    expect(idReads()).toBe(0)
  })

  it('rebuilds when the agent status slice changes', () => {
    const { tabsByWorktree, idReads, resetIdReads } = makeCountingTabs(WORKTREES)

    buildMobileSessionAgentStatusByWorktree(agentStatusByPaneKey, tabsByWorktree)
    const firstBuildReads = idReads()
    resetIdReads()

    buildMobileSessionAgentStatusByWorktree({ ...agentStatusByPaneKey }, tabsByWorktree)

    expect(idReads()).toBe(firstBuildReads)
  })

  it('rebuilds when the tabs slice changes', () => {
    const { tabsByWorktree, idReads, resetIdReads } = makeCountingTabs(WORKTREES)

    buildMobileSessionAgentStatusByWorktree(agentStatusByPaneKey, tabsByWorktree)
    const firstBuildReads = idReads()
    resetIdReads()

    buildMobileSessionAgentStatusByWorktree(agentStatusByPaneKey, { ...tabsByWorktree })

    expect(idReads()).toBe(firstBuildReads)
  })

  it('regroups a status entry onto the worktree its tab moved to', () => {
    const movedTab = { id: 'moved-term', title: 'Agent', customTitle: null, ptyId: null }
    const movedPaneKey = `moved-term:${STATUS_LEAF_ID}`
    const statusByPaneKey = {
      [movedPaneKey]: { state: 'working', paneKey: movedPaneKey }
    } as unknown as AppState['agentStatusByPaneKey']

    const before = buildMobileSessionAgentStatusByWorktree(statusByPaneKey, {
      'repo::/from': [movedTab]
    } as unknown as AppState['tabsByWorktree'])
    expect([...before.keys()]).toEqual(['repo::/from'])

    const after = buildMobileSessionAgentStatusByWorktree(statusByPaneKey, {
      'repo::/to': [movedTab]
    } as unknown as AppState['tabsByWorktree'])
    expect([...after.keys()]).toEqual(['repo::/to'])
  })
})

/** Distinct ids per file: the per-worktree snapshot memo is module state shared across tests. */
const REGISTERED_WT = 'repo::/memo-registered-wt'
const REGISTERED_LEAF_ID = 'cccccccc-1111-4111-8111-111111111111'

function makeRegistrationState(persistedWorktrees: number): AppState {
  const tabsByWorktree: Record<string, unknown[]> = {
    [REGISTERED_WT]: [
      { id: 'memo-registered-term', title: 'Mounted', customTitle: null, ptyId: null }
    ]
  }
  for (let index = 0; index < persistedWorktrees; index += 1) {
    tabsByWorktree[`repo::/memo-unmounted-wt-${index}`] = [
      {
        id: `memo-unmounted-term-${index}`,
        title: `Agent ${index}`,
        customTitle: null,
        ptyId: null
      }
    ]
  }
  return {
    tabsByWorktree,
    terminalLayoutsByTabId: {},
    runtimePaneTitlesByTabId: {},
    groupsByWorktree: {},
    activeGroupIdByWorktree: {},
    unifiedTabsByWorktree: {},
    tabBarOrderByWorktree: {},
    activeFileId: null,
    activeFileIdByWorktree: {},
    openFiles: [],
    editorDrafts: {},
    activeTabId: null,
    agentStatusByPaneKey: {},
    browserTabsByWorktree: {}
  } as unknown as AppState
}

function makeRegistration(tabId: string): Parameters<typeof registerRuntimeTerminalTab>[0] {
  const panes = [{ id: 1, leafId: REGISTERED_LEAF_ID }]
  const manager = {
    getPanes: () => panes.map((pane) => ({ ...pane })),
    getActivePane: () => panes[0] ?? null,
    getLeafId: (paneId: number) => panes.find((pane) => pane.id === paneId)?.leafId ?? null,
    getNumericIdForLeaf: (leafId: string) =>
      panes.find((pane) => pane.leafId === leafId)?.id ?? null
  }
  return {
    tabId,
    worktreeId: REGISTERED_WT,
    getManager: () => manager,
    getContainer: () => null,
    getPtyIdForPane: () => 'pty-memo-1',
    getTabWideAgentHintLeafId: () => REGISTERED_LEAF_ID
  } as unknown as Parameters<typeof registerRuntimeTerminalTab>[0]
}

describe('registered terminal tab index', () => {
  it('consults the registration map only for tabs that are actually mounted', () => {
    const state = makeRegistrationState(WORKTREES)
    const unregister = registerRuntimeTerminalTab(makeRegistration('memo-registered-term'))
    const lookups = vi.spyOn(graphState.registeredTabs, 'get')
    try {
      buildMobileSessionTabSnapshots(state)

      // Without the index every persisted tab probes the map; with it, only the mounted one does.
      expect(lookups.mock.calls.length).toBeLessThanOrEqual(2)
    } finally {
      lookups.mockRestore()
      unregister()
    }
  })

  it('stops reporting a tab as registered once its surface unmounts', () => {
    const state = makeRegistrationState(2)
    const unregister = registerRuntimeTerminalTab(makeRegistration('memo-registered-term'))
    const mounted = buildMobileSessionTabSnapshots(state).find(
      (snapshot) => snapshot.worktree === REGISTERED_WT
    )
    expect(mounted?.tabs).toEqual([expect.objectContaining({ ptyId: 'pty-memo-1' })])

    unregister()
    const after = buildMobileSessionTabSnapshots(state).find(
      (snapshot) => snapshot.worktree === REGISTERED_WT
    )

    expect(after?.tabs).not.toEqual([expect.objectContaining({ ptyId: 'pty-memo-1' })])
    expect(graphState.registeredTabIdsByWorktree.get(REGISTERED_WT)).toBeUndefined()
  })

  it('keeps the tab registered when a remount cleans up after its replacement', () => {
    const state = makeRegistrationState(2)
    const first = registerRuntimeTerminalTab(makeRegistration('memo-registered-term'))
    const second = registerRuntimeTerminalTab(makeRegistration('memo-registered-term'))
    try {
      // React can mount the replacement before the old effect tears down; the stale cleanup
      // must not evict the live registration from the index.
      first()

      expect(graphState.registeredTabIdsByWorktree.get(REGISTERED_WT)).toEqual(
        new Set(['memo-registered-term'])
      )
      const mounted = buildMobileSessionTabSnapshots(state).find(
        (snapshot) => snapshot.worktree === REGISTERED_WT
      )
      expect(mounted?.tabs).toEqual([expect.objectContaining({ ptyId: 'pty-memo-1' })])
    } finally {
      second()
    }
  })
})
