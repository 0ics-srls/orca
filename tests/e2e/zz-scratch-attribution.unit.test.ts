import { describe, it } from 'vitest'
import { normalizeAccumulatedWorkspaceFixtureOptions } from './accumulated-workspace-profile'
import { buildAccumulatedWorkspaceSeed } from './accumulated-workspace-state-builder'
import type { AppState } from '../../src/renderer/src/store/types'
import { buildMobileSessionTabSnapshots } from '../../src/renderer/src/runtime/sync-runtime-graph/mobile-session-snapshots'

function buildState(): AppState {
  const seed = buildAccumulatedWorkspaceSeed(normalizeAccumulatedWorkspaceFixtureOptions({}), 1e12)
  const agentStatusByPaneKey: Record<string, unknown> = {}
  for (const status of seed.liveStatuses) {
    agentStatusByPaneKey[status.paneKey] = {
      state: 'working',
      prompt: status.prompt,
      agentType: 'codex',
      updatedAt: 1e12,
      stateStartedAt: 1e12,
      paneKey: status.paneKey,
      stateHistory: []
    }
  }
  return {
    repos: seed.repos,
    worktreesByRepo: seed.worktreesByRepo,
    tabsByWorktree: seed.tabsByWorktree,
    terminalLayoutsByTabId: seed.terminalLayoutsByTabId,
    unifiedTabsByWorktree: seed.unifiedTabsByWorktree,
    groupsByWorktree: seed.groupsByWorktree,
    activeGroupIdByWorktree: seed.activeGroupIdByWorktree,
    layoutByWorktree: seed.layoutByWorktree,
    agentStatusByPaneKey,
    openFiles: [],
    editorDrafts: {},
    browserTabsByWorktree: {},
    browserPagesByWorkspace: {},
    browserCertificateFailuresByPageId: {},
    runtimePaneTitlesByTabId: {},
    nativeChatLaunchDraftByTabId: {},
    tabBarOrderByWorktree: {},
    activeFileIdByWorktree: {},
    activeTabTypeByWorktree: {},
    activeBrowserTabIdByWorktree: {},
    folderWorkspaces: [],
    activeFileId: null,
    activeTabId: null,
    activeTabType: null,
    settings: { tabAutoGenerateTitle: false }
  } as unknown as AppState
}

function time(label: string, iterations: number, run: (index: number) => void): void {
  run(0)
  const start = process.hrtime.bigint()
  for (let index = 0; index < iterations; index += 1) {
    run(index)
  }
  const totalMs = Number(process.hrtime.bigint() - start) / 1e6
  process.stderr.write(`ATTR ${label}: ${(totalMs / iterations).toFixed(3)} ms/pub\n`)
}

describe('scratch attribution', () => {
  it('attributes publication cost', () => {
    let state = buildState()
    const worktreeIds = Object.keys(state.tabsByWorktree)
    const statusPaneKeys = Object.keys(state.agentStatusByPaneKey)
    buildMobileSessionTabSnapshots(state, false)

    time('status frame', 60, (index) => {
      const paneKey = statusPaneKeys[index % statusPaneKeys.length]
      const previous = state.agentStatusByPaneKey[paneKey]
      state = {
        ...state,
        agentStatusByPaneKey: {
          ...state.agentStatusByPaneKey,
          [paneKey]: { ...previous, state: index % 2 ? 'waiting' : 'working' }
        }
      } as AppState
      buildMobileSessionTabSnapshots(state, false)
    })

    time('runtime pane title frame', 60, (index) => {
      const tabId = state.tabsByWorktree[worktreeIds[index % worktreeIds.length]][0].id
      state = {
        ...state,
        runtimePaneTitlesByTabId: {
          ...state.runtimePaneTitlesByTabId,
          [tabId]: { 1: `title-${index}` }
        }
      } as AppState
      buildMobileSessionTabSnapshots(state, false)
    })

    time('tab title frame', 60, (index) => {
      const worktreeId = worktreeIds[index % worktreeIds.length]
      const tabs = state.tabsByWorktree[worktreeId]
      state = {
        ...state,
        tabsByWorktree: {
          ...state.tabsByWorktree,
          [worktreeId]: [{ ...tabs[0], title: `t-${index}` }, ...tabs.slice(1)]
        }
      } as AppState
      buildMobileSessionTabSnapshots(state, false)
    })

    time('no change', 60, () => {
      buildMobileSessionTabSnapshots(state, false)
    })

    process.stderr.write(
      `ATTR worktrees=${worktreeIds.length} tabs=${Object.values(state.tabsByWorktree).flat().length} statuses=${statusPaneKeys.length}\n`
    )
  }, 300_000)
})
