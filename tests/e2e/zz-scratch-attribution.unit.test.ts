import { describe, it } from 'vitest'
import { normalizeAccumulatedWorkspaceFixtureOptions } from './accumulated-workspace-profile'
import { buildAccumulatedWorkspaceSeed } from './accumulated-workspace-state-builder'
import type { AppState } from '@/store/types'
import { buildMobileSessionTabSnapshots } from '../../src/renderer/src/runtime/sync-runtime-graph/mobile-session-snapshots'
import {
  buildMobileSessionAgentStatusByWorktree,
  buildMobileSessionWorktreeInputs,
  getOpenFileIndexes
} from '../../src/renderer/src/runtime/sync-runtime-graph/mobile-session-inputs'
import { canReuseMobileSessionSnapshot } from '../../src/renderer/src/runtime/sync-runtime-graph/mobile-session-capture'
import {
  collectAmbiguousTerminalTabIds,
  getTerminalTabOwnershipIndex,
  graphState
} from '../../src/renderer/src/runtime/sync-runtime-graph/graph-state'
import { createTabKeyedRecordPartitioner } from '../../src/renderer/src/runtime/sync-runtime-graph/tab-keyed-record-partition'
import {
  collectMobileSessionWorktreeSourceRefs,
  mobileSessionWorktreeSourceRefsEqual
} from '../../src/renderer/src/runtime/sync-runtime-graph/mobile-session-worktree-sources'
import { parseWorkspaceKey } from '../../src/shared/workspace-scope'
import { getEditorDraftVersionByFileId } from '../../src/renderer/src/runtime/sync-runtime-graph/sync-projections'
import { getMobileTerminalTheme } from '../../src/renderer/src/runtime/sync-runtime-graph/mobile-terminal-theme'

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
      tabId: status.tabId,
      worktreeId: status.worktreeId
    }
  }
  const state = {
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
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: scratch attribution harness; only the fields read by buildMobileSessionTabSnapshots matter.
  return state as unknown as AppState
}

function bumpStatus(state: AppState): AppState {
  // One OSC status frame: copy-on-write of exactly one slice, as the store does.
  const next: Record<string, unknown> = { ...state.agentStatusByPaneKey }
  const firstKey = Object.keys(next)[0]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: scratch harness.
  const prev = next[firstKey] as Record<string, unknown>
  next[firstKey] = { ...prev, state: prev.state === 'working' ? 'waiting' : 'working' }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: scratch harness.
  return { ...state, agentStatusByPaneKey: next } as AppState
}

function time(label: string, iterations: number, run: () => void): void {
  run()
  const start = process.hrtime.bigint()
  for (let index = 0; index < iterations; index += 1) {
    run()
  }
  const totalMs = Number(process.hrtime.bigint() - start) / 1e6
  process.stderr.write(`ATTR ${label}: ${(totalMs / iterations).toFixed(3)} ms/pub\n`)
}

describe('scratch attribution', () => {
  it('attributes publication cost', () => {
    let state = buildState()
    const worktreeCount = new Set([
      ...Object.keys(state.tabsByWorktree),
      ...Object.keys(state.groupsByWorktree),
      ...Object.keys(state.unifiedTabsByWorktree)
    ]).size
    console.log(
      `worktrees=${worktreeCount} tabs=${Object.values(state.tabsByWorktree).flat().length} statuses=${Object.keys(state.agentStatusByPaneKey).length}`
    )

    // Warm the caches the way a steady-state session would be warmed.
    buildMobileSessionTabSnapshots(state, false)

    time('FULL buildMobileSessionTabSnapshots (status frame)', 40, () => {
      state = bumpStatus(state)
      buildMobileSessionTabSnapshots(state, false)
    })

    time('FULL buildMobileSessionTabSnapshots (no change)', 40, () => {
      buildMobileSessionTabSnapshots(state, false)
    })

    time('part: buildMobileSessionAgentStatusByWorktree (status frame)', 40, () => {
      state = bumpStatus(state)
      buildMobileSessionAgentStatusByWorktree(state.agentStatusByPaneKey, state.tabsByWorktree)
    })

    time('part: collectAmbiguousTerminalTabIds (memoized)', 40, () => {
      collectAmbiguousTerminalTabIds(state.tabsByWorktree)
    })

    // Per-worktree input build + reuse compare, excluding the agent-status grouping.
    const ambiguous = collectAmbiguousTerminalTabIds(state.tabsByWorktree)
    // oxlint-disable-next-line typescript/no-explicit-any -- SAFETY: scratch harness.
    const partitionLayouts = createTabKeyedRecordPartitioner<any>()
    // oxlint-disable-next-line typescript/no-explicit-any -- SAFETY: scratch harness.
    const partitionTitles = createTabKeyedRecordPartitioner<any>()
    // oxlint-disable-next-line typescript/no-explicit-any -- SAFETY: scratch harness.
    const partitionDrafts = createTabKeyedRecordPartitioner<any>()
    const owners = getTerminalTabOwnershipIndex(state.tabsByWorktree)
    const buildPublication = (): Parameters<typeof buildMobileSessionWorktreeInputs>[2] => ({
      browserTabsByWorktree: state.browserTabsByWorktree ?? {},
      openFileIndexes: getOpenFileIndexes(state.openFiles),
      editorDraftVersionByFileId: getEditorDraftVersionByFileId(state.editorDrafts),
      agentStatusByWorktreeId: buildMobileSessionAgentStatusByWorktree(
        state.agentStatusByPaneKey,
        state.tabsByWorktree
      ),
      terminalLayoutByWorktree: partitionLayouts(state.terminalLayoutsByTabId, owners),
      runtimePaneTitleByWorktree: partitionTitles(state.runtimePaneTitlesByTabId, owners),
      launchDraftByWorktree: partitionDrafts(state.nativeChatLaunchDraftByTabId, owners),
      generatedTitlesEnabled: false,
      terminalTheme: getMobileTerminalTheme(state, false)
    })
    const worktreeIds = Object.keys(state.tabsByWorktree)
    time('part: per-worktree inputs build only', 40, () => {
      const publication = buildPublication()
      for (const worktreeId of worktreeIds) {
        buildMobileSessionWorktreeInputs(state, worktreeId, publication, ambiguous)
      }
    })
    time('part: per-worktree inputs build + canReuse compare', 40, () => {
      const publication = buildPublication()
      for (const worktreeId of worktreeIds) {
        const inputs = buildMobileSessionWorktreeInputs(state, worktreeId, publication, ambiguous)
        const cached = graphState.mobileSessionSnapshotCacheByWorktree.get(worktreeId)
        if (cached) {
          canReuseMobileSessionSnapshot(cached.inputs, inputs)
        }
      }
    })
    time('part: parseWorkspaceKey per worktree', 40, () => {
      for (const worktreeId of worktreeIds) {
        parseWorkspaceKey(worktreeId)
      }
    })
    time('part: sourceRefs collect + compare', 40, () => {
      const publication = buildPublication()
      const ownersNow = getTerminalTabOwnershipIndex(state.tabsByWorktree)
      for (const worktreeId of worktreeIds) {
        const refs = collectMobileSessionWorktreeSourceRefs(
          state,
          worktreeId,
          publication,
          ownersNow
        )
        const cached = graphState.mobileSessionSnapshotCacheByWorktree.get(worktreeId)
        if (cached) {
          mobileSessionWorktreeSourceRefsEqual(cached.sourceRefs, refs)
        }
      }
    })
    time('part: worktreeIds set build only', 40, () => {
      const browserTabsByWorktree = state.browserTabsByWorktree ?? {}
      new Set<string>([
        ...Object.keys(state.tabsByWorktree),
        ...Object.keys(state.groupsByWorktree),
        ...Object.keys(state.unifiedTabsByWorktree),
        ...Object.keys(browserTabsByWorktree),
        ...state.openFiles.map((file) => file.worktreeId)
      ])
    })

    const statusBuckets = buildMobileSessionAgentStatusByWorktree(
      state.agentStatusByPaneKey,
      state.tabsByWorktree
    )
    let nonEmptyBuckets = 0
    for (const worktreeId of worktreeIds) {
      if ((statusBuckets.get(worktreeId)?.size ?? 0) > 0) {
        nonEmptyBuckets += 1
      }
    }
    process.stderr.write(
      `ATTR worktrees=${worktreeIds.length} worktreesWithAgentStatus=${nonEmptyBuckets} tabs=${Object.values(state.tabsByWorktree).flat().length} statuses=${Object.keys(state.agentStatusByPaneKey).length}\n`
    )
  }, 300_000)
})
