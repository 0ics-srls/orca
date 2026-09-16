import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { AppState } from '../store/types'
import {
  buildMobileSessionTabSnapshots,
  registerRuntimeTerminalTab,
  resetRuntimeMobileSyncProjectionCachesForTests
} from './sync-runtime-graph'
import {
  getTerminalTabOwnershipIndex,
  graphState,
  resetRuntimeGraphSliceScanCaches
} from './sync-runtime-graph/graph-state'
import {
  buildMobileSessionAgentStatusByWorktree,
  buildMobileSessionWorktreeInputs,
  getOpenFileIndexes
} from './sync-runtime-graph/mobile-session-inputs'
import {
  collectMobileSessionWorktreeIds,
  collectMobileSessionWorktreeSourceRefs,
  resetMobileSessionWorktreeIdCacheForTests
} from './sync-runtime-graph/mobile-session-worktree-sources'
import { createTabKeyedRecordPartitioner } from './sync-runtime-graph/tab-keyed-record-partition'
import { getEditorDraftVersionByFileId } from './sync-runtime-graph/sync-projections'
import { getMobileTerminalTheme } from './sync-runtime-graph/mobile-terminal-theme'
import type { MobileSessionPublicationInputs } from './sync-runtime-graph/types'

/**
 * Why operation counts and not wall clock: the gate exists so a publication costs what the frame
 * changed rather than what the session accumulated. A millisecond threshold would track the test
 * machine; asserting that the work does not grow with the worktree count does not.
 */

const LEAF_ID = 'eeeeeeee-1111-4111-8111-111111111111'
const DIRTY_WT = 'repo::/gate-dirty'
const MOUNTED_WT = 'repo::/gate-mounted'

function makeTab(id: string, worktreeId: string, title = 'Agent'): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function makeStatusEntry(paneKey: string, state: AgentStatusEntry['state']): AgentStatusEntry {
  return { state, prompt: '', updatedAt: 1, stateStartedAt: 1, paneKey, stateHistory: [] }
}

function makeLayout(ptyId: string): unknown {
  return {
    root: { type: 'leaf', leafId: LEAF_ID },
    activeLeafId: LEAF_ID,
    ptyIdsByLeafId: { [LEAF_ID]: ptyId }
  }
}

/** `tab.id` is read only while a builder walks a worktree's tabs, so its reads count rebuilds. */
function makeGateState(filler: number): {
  state: AppState
  tabIdReads: () => number
  resetTabIdReads: () => void
} {
  let tabIdReads = 0
  const countingTab = (id: string, worktreeId: string, title?: string): TerminalTab => ({
    ...makeTab(id, worktreeId, title),
    get id() {
      tabIdReads += 1
      return id
    }
  })
  const tabsByWorktree: Record<string, TerminalTab[]> = {
    [DIRTY_WT]: [countingTab('gate-dirty-term', DIRTY_WT)]
  }
  const terminalLayoutsByTabId: Record<string, unknown> = {
    'gate-dirty-term': makeLayout('pty-gate-dirty')
  }
  for (let index = 0; index < filler; index += 1) {
    const worktreeId = `repo::/gate-filler-${index}`
    tabsByWorktree[worktreeId] = [countingTab(`gate-filler-term-${index}`, worktreeId)]
    terminalLayoutsByTabId[`gate-filler-term-${index}`] = makeLayout(`pty-gate-filler-${index}`)
  }
  const state = {
    tabsByWorktree,
    terminalLayoutsByTabId,
    runtimePaneTitlesByTabId: {},
    nativeChatLaunchDraftByTabId: {},
    groupsByWorktree: {},
    activeGroupIdByWorktree: {},
    layoutByWorktree: {},
    unifiedTabsByWorktree: {},
    tabBarOrderByWorktree: {},
    activeFileId: null,
    activeFileIdByWorktree: {},
    activeTabType: null,
    activeTabTypeByWorktree: {},
    activeBrowserTabIdByWorktree: {},
    openFiles: [],
    editorDrafts: {},
    activeTabId: null,
    agentStatusByPaneKey: {
      [`gate-dirty-term:${LEAF_ID}`]: makeStatusEntry(`gate-dirty-term:${LEAF_ID}`, 'working')
    },
    browserTabsByWorktree: {},
    browserPagesByWorkspace: {},
    browserCertificateFailuresByPageId: {},
    worktreesByRepo: {},
    folderWorkspaces: [],
    settings: { tabAutoGenerateTitle: false }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the publication path reads only the slices assigned here; a full AppState is not constructible in a unit test.
  } as unknown as AppState
  return {
    state,
    tabIdReads: () => tabIdReads,
    resetTabIdReads: () => {
      tabIdReads = 0
    }
  }
}

function withChangedStatus(state: AppState, nextState: AgentStatusEntry['state']): AppState {
  const paneKey = `gate-dirty-term:${LEAF_ID}`
  return {
    ...state,
    agentStatusByPaneKey: { [paneKey]: makeStatusEntry(paneKey, nextState) }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: one slice replaced on the same partial state; see makeGateState.
  } as AppState
}

function resetPublicationCaches(): void {
  graphState.mobileSessionSnapshotCacheByWorktree.clear()
  graphState.publishedMobileSessionSnapshotByWorktree.clear()
  resetRuntimeGraphSliceScanCaches()
  resetRuntimeMobileSyncProjectionCachesForTests()
  resetMobileSessionWorktreeIdCacheForTests()
}

/** `snapshotVersion` counts rebuilds, so it must not be part of a content comparison. */
function contentOf(snapshots: ReturnType<typeof buildMobileSessionTabSnapshots>): unknown {
  return snapshots.map(({ snapshotVersion: _version, ...rest }) => rest)
}

beforeEach(() => {
  resetPublicationCaches()
})

describe('mobile session publication skips worktrees the frame did not touch', () => {
  it('costs the same whether the session holds 20 worktrees or 400', () => {
    const counts = [20, 400].map((filler) => {
      resetPublicationCaches()
      const { state, tabIdReads, resetTabIdReads } = makeGateState(filler)
      buildMobileSessionTabSnapshots(state, false)
      resetTabIdReads()
      buildMobileSessionTabSnapshots(withChangedStatus(state, 'waiting'), false)
      return tabIdReads()
    })

    expect(counts[0]).toBeGreaterThan(0)
    expect(counts[1]).toBe(counts[0])
  })

  it('still republishes the worktree whose status changed', () => {
    const { state } = makeGateState(20)
    const statusOf = (snapshots: ReturnType<typeof buildMobileSessionTabSnapshots>): unknown =>
      snapshots.find((snapshot) => snapshot.worktree === DIRTY_WT)?.tabs[0]?.agentStatus?.state

    expect(statusOf(buildMobileSessionTabSnapshots(state, false))).toBe('working')
    expect(
      statusOf(buildMobileSessionTabSnapshots(withChangedStatus(state, 'waiting'), false))
    ).toBe('waiting')
  })
})

describe('the gate reads every store value the inputs builder reads', () => {
  it('records no AppState key the source-ref collector misses', () => {
    const { state } = makeGateState(2)
    const owners = getTerminalTabOwnershipIndex(state.tabsByWorktree)
    const publication: MobileSessionPublicationInputs = {
      browserTabsByWorktree: state.browserTabsByWorktree ?? {},
      openFileIndexes: getOpenFileIndexes(state.openFiles),
      editorDraftVersionByFileId: getEditorDraftVersionByFileId(state.editorDrafts),
      agentStatusByWorktreeId: buildMobileSessionAgentStatusByWorktree(
        state.agentStatusByPaneKey,
        state.tabsByWorktree
      ),
      terminalLayoutByWorktree: createTabKeyedRecordPartitioner<
        AppState['terminalLayoutsByTabId'][string]
      >()(state.terminalLayoutsByTabId, owners),
      runtimePaneTitleByWorktree: createTabKeyedRecordPartitioner<
        AppState['runtimePaneTitlesByTabId'][string]
      >()(state.runtimePaneTitlesByTabId, owners),
      launchDraftByWorktree: createTabKeyedRecordPartitioner<
        NonNullable<AppState['nativeChatLaunchDraftByTabId']>[string]
      >()(state.nativeChatLaunchDraftByTabId, owners),
      generatedTitlesEnabled: false,
      terminalTheme: getMobileTerminalTheme(state, false)
    }
    const recordKeyReads = (run: (observed: AppState) => void): Set<string> => {
      const reads = new Set<string>()
      run(
        new Proxy(state, {
          get: (target, key) => {
            if (typeof key === 'string') {
              reads.add(key)
            }
            return Reflect.get(target, key)
          }
        })
      )
      return reads
    }

    const builderReads = recordKeyReads((observed) => {
      buildMobileSessionWorktreeInputs(observed, DIRTY_WT, publication, owners.ambiguousTabIds)
    })
    const collectorReads = recordKeyReads((observed) => {
      collectMobileSessionWorktreeSourceRefs(observed, DIRTY_WT, publication, owners)
    })

    expect([...builderReads].filter((key) => !collectorReads.has(key))).toEqual([])
    expect(builderReads.size).toBeGreaterThan(5)
  })
})

describe('the gate never publishes a stale worktree', () => {
  const mutations: { name: string; apply: (state: AppState) => AppState }[] = [
    {
      name: 'a terminal tab title',
      apply: (state) => ({
        ...state,
        tabsByWorktree: {
          ...state.tabsByWorktree,
          [DIRTY_WT]: [makeTab('gate-dirty-term', DIRTY_WT, 'Renamed')]
        }
      })
    },
    { name: 'an agent status', apply: (state) => withChangedStatus(state, 'waiting') },
    {
      name: 'a runtime pane title',
      apply: (state) => ({
        ...state,
        runtimePaneTitlesByTabId: { 'gate-dirty-term': { 1: 'vim' } }
      })
    },
    {
      name: 'a saved terminal layout',
      apply: (state) =>
        ({
          ...state,
          terminalLayoutsByTabId: {
            'gate-dirty-term': {
              root: { type: 'leaf', leafId: LEAF_ID },
              activeLeafId: LEAF_ID,
              ptyIdsByLeafId: { [LEAF_ID]: 'pty-gate-1' }
            }
          }
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial state; see makeGateState.
        }) as AppState
    },
    {
      name: 'the active tab',
      apply: (state) => ({ ...state, activeTabId: 'gate-dirty-term' })
    },
    {
      name: 'a tab group',
      apply: (state) => ({
        ...state,
        groupsByWorktree: {
          ...state.groupsByWorktree,
          [DIRTY_WT]: [
            {
              id: 'gate-group',
              worktreeId: DIRTY_WT,
              activeTabId: 'gate-dirty-term',
              tabOrder: ['gate-dirty-term']
            }
          ]
        },
        activeGroupIdByWorktree: { ...state.activeGroupIdByWorktree, [DIRTY_WT]: 'gate-group' }
      })
    },
    {
      name: 'the generated-title setting',
      apply: (state) =>
        ({
          ...state,
          settings: { ...state.settings, tabAutoGenerateTitle: true }
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial state; see makeGateState.
        }) as AppState
    },
    {
      name: 'the worktree that owns a tab',
      apply: (state) => ({
        ...state,
        tabsByWorktree: {
          ...state.tabsByWorktree,
          [DIRTY_WT]: [],
          'repo::/gate-filler-0': [
            makeTab('gate-filler-term-0', 'repo::/gate-filler-0'),
            makeTab('gate-dirty-term', 'repo::/gate-filler-0')
          ]
        }
      })
    }
  ]

  for (const mutation of mutations) {
    it(`publishes what a cold rebuild would after ${mutation.name} changes`, () => {
      const { state } = makeGateState(12)
      buildMobileSessionTabSnapshots(state, false)
      const mutated = mutation.apply(state)

      const gated = contentOf(buildMobileSessionTabSnapshots(mutated, false))
      graphState.mobileSessionSnapshotCacheByWorktree.clear()
      const cold = contentOf(buildMobileSessionTabSnapshots(mutated, false))

      expect(gated).toEqual(cold)
    })
  }
})

describe('a mounted worktree is never gated on store references alone', () => {
  it('republishes when only the live PaneManager moved', () => {
    const panes = [
      { id: 1, leafId: LEAF_ID },
      { id: 2, leafId: 'ffffffff-1111-4111-8111-111111111111' }
    ]
    let activeIndex = 0
    const manager = {
      getPanes: () => panes.map((pane) => ({ ...pane })),
      getActivePane: () => panes[activeIndex] ?? null,
      getLeafId: (paneId: number) => panes.find((pane) => pane.id === paneId)?.leafId ?? null,
      getNumericIdForLeaf: (leafId: string) =>
        panes.find((pane) => pane.leafId === leafId)?.id ?? null
    }
    const { state } = makeGateState(12)
    const mountedState = {
      ...state,
      tabsByWorktree: {
        ...state.tabsByWorktree,
        [MOUNTED_WT]: [makeTab('gate-mounted-term', MOUNTED_WT)]
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial state; see makeGateState.
    } as AppState
    const unregister = registerRuntimeTerminalTab({
      tabId: 'gate-mounted-term',
      worktreeId: MOUNTED_WT,
      getManager: () => manager,
      getContainer: () => null,
      getPtyIdForPane: (paneId: number) => `pty-gate-${paneId}`,
      getTabWideAgentHintLeafId: () => LEAF_ID
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the publication path calls only the PaneManager members stubbed above.
    } as unknown as Parameters<typeof registerRuntimeTerminalTab>[0])
    try {
      const activeLeafOf = (): unknown =>
        buildMobileSessionTabSnapshots(mountedState, false).find(
          (snapshot) => snapshot.worktree === MOUNTED_WT
        )?.tabs[0]?.parentLayout?.activeLeafId

      const before = activeLeafOf()
      activeIndex = 1
      const after = activeLeafOf()

      expect(before).toBe(LEAF_ID)
      expect(after).toBe('ffffffff-1111-4111-8111-111111111111')
    } finally {
      unregister()
    }
  })
})

describe('publication-wide memos the gate depends on', () => {
  it('reuses the worktree id set until one of its source slices is replaced', () => {
    const { state } = makeGateState(4)
    const first = collectMobileSessionWorktreeIds(state, state.browserTabsByWorktree ?? {})

    expect(collectMobileSessionWorktreeIds(state, state.browserTabsByWorktree ?? {})).toBe(first)

    const withNewWorktree = {
      ...state,
      groupsByWorktree: { ...state.groupsByWorktree, 'repo::/gate-late': [] }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial state; see makeGateState.
    } as AppState
    const second = collectMobileSessionWorktreeIds(
      withNewWorktree,
      withNewWorktree.browserTabsByWorktree ?? {}
    )

    expect(second).not.toBe(first)
    expect(second.has('repo::/gate-late')).toBe(true)
  })

  it('keeps an untouched worktree bucket identical when a tab-keyed record is replaced', () => {
    const { state } = makeGateState(4)
    const owners = getTerminalTabOwnershipIndex(state.tabsByWorktree)
    const partition = createTabKeyedRecordPartitioner<Record<number, string>>()
    // The store replaces the record but keeps every untouched entry object, which is what the
    // bucket comparison relies on.
    const untouched = { 1: 'vim' }
    const before = partition({ 'gate-dirty-term': untouched }, owners)
    const after = partition(
      { 'gate-dirty-term': untouched, 'gate-filler-term-0': { 1: 'less' } },
      owners
    )

    expect(after.get(DIRTY_WT)).toBe(before.get(DIRTY_WT))
    expect(after.get('repo::/gate-filler-0')?.get('gate-filler-term-0')).toEqual({ 1: 'less' })
  })

  it('drops a bucket whose tab id became ambiguous', () => {
    const owners = getTerminalTabOwnershipIndex({
      [DIRTY_WT]: [makeTab('shared-term', DIRTY_WT)],
      'repo::/gate-other': [makeTab('shared-term', 'repo::/gate-other')]
    })
    const partition = createTabKeyedRecordPartitioner<Record<number, string>>()

    expect([...partition({ 'shared-term': { 1: 'vim' } }, owners).keys()]).toEqual([])
  })
})
