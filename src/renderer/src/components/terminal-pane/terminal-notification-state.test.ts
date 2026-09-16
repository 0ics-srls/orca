// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { makeTerminalTab, makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import { countReposNeedingNotificationDisambiguation } from './terminal-notification-state'

const NOW = 1_700_000_000_000
const LEAF = '11111111-1111-4111-8111-111111111111'

function status(tabId: string, updatedAt = NOW): AgentStatusEntry {
  return {
    paneKey: `${tabId}:${LEAF}`,
    state: 'working',
    agentType: 'codex',
    prompt: 'Notification benchmark',
    updatedAt,
    stateStartedAt: updatedAt,
    terminalTitle: 'Codex',
    stateHistory: []
  }
}

function stateWithWorkspaces(count: number, repos: number): AppState {
  const state = { ...useAppStore.getInitialState(), worktreesByRepo: {}, tabsByWorktree: {} }
  const worktreesByRepo: AppState['worktreesByRepo'] = {}
  const tabsByWorktree: AppState['tabsByWorktree'] = {}
  for (let index = 0; index < count; index++) {
    const repoId = `repo-${index % repos}`
    const id = `wt-${index}`
    ;(worktreesByRepo[repoId] ??= []).push(makeWorktree({ id, repoId }))
    tabsByWorktree[id] = [makeTerminalTab({ id: `tab-${index}`, worktreeId: id })]
  }
  return { ...state, worktreesByRepo, tabsByWorktree }
}

afterEach(() => vi.restoreAllMocks())

describe('notification project disambiguation', () => {
  it('visits agent rows once at the reported 870-workspace scale', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const state = stateWithWorkspaces(870, 27)
    let paneKeyReads = 0
    let retainedWorktreeReads = 0
    state.agentStatusByPaneKey = Object.fromEntries(
      Array.from({ length: 177 }, (_, index) => {
        const entry = status(`tab-${index}`)
        return [
          entry.paneKey,
          {
            ...entry,
            get paneKey() {
              paneKeyReads++
              return entry.paneKey
            }
          }
        ]
      })
    )
    state.retainedAgentsByPaneKey = {
      retained: {
        entry: status('tab-869'),
        tab: state.tabsByWorktree['wt-869'][0],
        agentType: 'codex',
        startedAt: NOW,
        get worktreeId() {
          retainedWorktreeReads++
          return 'wt-869'
        }
      }
    }

    expect(countReposNeedingNotificationDisambiguation(state)).toBe(27)
    expect(paneKeyReads).toBeLessThanOrEqual(177)
    expect(retainedWorktreeReads).toBeLessThanOrEqual(1)
  })

  it('keeps inactive projects in the disambiguation count and ignores empty buckets', () => {
    const state = stateWithWorkspaces(2, 2)
    state.worktreesByRepo.empty = []
    expect(countReposNeedingNotificationDisambiguation(state)).toBe(2)
    expect(countReposNeedingNotificationDisambiguation(stateWithWorkspaces(1, 1))).toBe(1)
    expect(countReposNeedingNotificationDisambiguation(stateWithWorkspaces(0, 1))).toBe(0)
  })

  it('preserves active row ownership while repository buckets differ during hydration', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const state = stateWithWorkspaces(2, 1)
    state.worktreesByRepo['repo-0'] = [
      makeWorktree({ id: 'wt-0', repoId: 'repo-0' }),
      makeWorktree({ id: 'wt-1', repoId: 'remote-project', hostId: 'ssh:server' })
    ]
    const first = status('tab-0')
    const second = status('tab-1')
    state.agentStatusByPaneKey = { [first.paneKey]: first, [second.paneKey]: second }
    expect(countReposNeedingNotificationDisambiguation(state)).toBe(2)

    state.agentStatusByPaneKey = {
      [first.paneKey]: first,
      [second.paneKey]: status('tab-1', NOW - AGENT_STATUS_STALE_AFTER_MS - 1)
    }
    expect(countReposNeedingNotificationDisambiguation(state)).toBe(1)

    state.ptyIdsByTabId = { 'tab-1': ['remote:pty-1'] }
    expect(countReposNeedingNotificationDisambiguation(state)).toBe(2)
    state.suppressedPtyExitIds = { 'remote:pty-1': true }
    expect(countReposNeedingNotificationDisambiguation(state)).toBe(1)

    state.agentStatusByPaneKey[second.paneKey] = {
      ...state.agentStatusByPaneKey[second.paneKey],
      mirroredEvidenceReceivedAt: NOW
    }
    expect(countReposNeedingNotificationDisambiguation(state)).toBe(2)
    state.agentStatusByPaneKey[second.paneKey] = {
      ...second,
      restoredUnconfirmed: true
    }
    expect(countReposNeedingNotificationDisambiguation(state)).toBe(1)
  })

  it('does not invent a repository for a folder workspace', () => {
    const state = stateWithWorkspaces(1, 1)
    state.tabsByWorktree['folder:notes'] = [
      makeTerminalTab({ id: 'folder-tab', worktreeId: 'folder:notes' })
    ]
    state.ptyIdsByTabId = { 'folder-tab': ['folder-pty'] }
    expect(countReposNeedingNotificationDisambiguation(state)).toBe(1)
  })
})
