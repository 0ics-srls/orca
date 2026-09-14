import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { toWebTerminalSurfaceTabId } from '../../../../shared/terminal-surface-id'
import { applyWebSessionTabsSnapshot } from '../../runtime/web-session-tabs-sync'
import {
  ENV,
  LEAF_ID,
  NOW,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from '../../runtime/web-session-tabs-sync-test-harness'
import { buildWorktreeAgentRows } from './worktree-agent-rows'
import { selectLiveAgentStatusEntriesForWorktree } from './worktree-agent-row-selectors'

vi.mock('../../store', () => ({ useAppStore: { setState: vi.fn() } }))

function status(tabId: string, worktreeId: string): AgentStatusEntry {
  return {
    paneKey: makePaneKey(tabId, LEAF_ID),
    tabId,
    worktreeId,
    agentType: 'omp',
    state: 'done',
    prompt: 'Finished the change',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: []
  }
}

function rows(state: ReturnType<typeof makeState>, worktreeId: string) {
  return buildWorktreeAgentRows({
    tabs: state.tabsByWorktree[worktreeId] ?? [],
    entries: selectLiveAgentStatusEntriesForWorktree(
      { ...state, migrationUnsupportedByPtyId: {}, retainedAgentsByPaneKey: {} },
      worktreeId
    ),
    retained: [],
    now: NOW
  })
}

describe('remote completed sidebar rows before tab hydration', () => {
  beforeEach(resetWebSessionTabsSyncTestState)

  it.each(['repo::/worktree', 'folder:remote-workspace'])(
    'shows a paired OMP row once before and after hydration in %s, then honors host retraction',
    (worktreeId) => {
      const hostEntry = status('host-tab', worktreeId)
      const hostSnapshot = makeSnapshot(
        [
          {
            type: 'terminal',
            id: `host-tab::${LEAF_ID}`,
            parentTabId: 'host-tab',
            leafId: LEAF_ID,
            title: 'OMP',
            isActive: false,
            status: 'ready',
            terminal: 'terminal-1',
            agentStatus: hostEntry
          }
        ],
        { worktree: worktreeId }
      )
      const initial = makeState({ activeWorktreeId: 'other-workspace' })
      const mirror = { ...initial, ...applyWebSessionTabsSnapshot(initial, hostSnapshot, ENV, NOW) }
      const paneKey = makePaneKey(toWebTerminalSurfaceTabId('host-tab'), LEAF_ID)
      expect(mirror.agentStatusByPaneKey[paneKey].connectionId).toBeUndefined()
      // Exercise the reported join failure: status is present before this renderer has the tab.
      const beforeTabs = { ...mirror, tabsByWorktree: {}, unifiedTabsByWorktree: {} }
      expect(rows(beforeTabs, worktreeId)).toMatchObject([
        { paneKey, state: 'done', agentType: 'omp' }
      ])
      expect(rows(mirror, worktreeId)).toMatchObject([{ paneKey, state: 'done', agentType: 'omp' }])
      expect(rows(mirror, worktreeId)).toHaveLength(1)
      const removed = {
        ...mirror,
        ...applyWebSessionTabsSnapshot(
          mirror,
          makeSnapshot([], { worktree: worktreeId, snapshotVersion: 2 }),
          ENV,
          NOW + 1
        )
      }
      expect(removed.agentStatusByPaneKey[paneKey]).toBeUndefined()
      expect(rows(removed, worktreeId)).toEqual([])
    }
  )

  it('honors status removal before tab hydration', () => {
    const worktreeId = 'folder:remote-workspace'
    const entry = status(toWebTerminalSurfaceTabId('host-tab'), worktreeId)
    const state = makeState({ agentStatusByPaneKey: { [entry.paneKey]: entry } })
    expect(rows(state, worktreeId)).toHaveLength(1)
    expect(rows({ ...state, agentStatusByPaneKey: {} }, worktreeId)).toEqual([])
  })

  it('rebuilds same-key buckets when SSH attribution arrives or is removed', () => {
    const worktreeId = 'folder:remote-workspace'
    const entry = status('ssh-tab', worktreeId)
    const initial = makeState({ agentStatusByPaneKey: { [entry.paneKey]: entry } })
    expect(rows(initial, worktreeId)).toEqual([])
    const remote = {
      ...initial,
      agentStatusByPaneKey: { [entry.paneKey]: { ...entry, connectionId: 'ssh-1' } }
    }
    expect(rows(remote, worktreeId)).toHaveLength(1)
    const updated = {
      ...remote,
      agentStatusByPaneKey: {
        [entry.paneKey]: { ...remote.agentStatusByPaneKey[entry.paneKey], prompt: 'New preview' }
      }
    }
    expect(rows(updated, worktreeId)[0].entry.prompt).toBe('New preview')
    expect(rows(initial, worktreeId)).toEqual([])
  })
})
