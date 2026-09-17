// @vitest-environment happy-dom
/**
 * Deterministic, count-based reproduction for STA-7552 (under STA-7551).
 *
 * Zustand notifies every subscriber synchronously on every `set`, and each
 * subscriber re-runs its selector. A single pane title update therefore pays
 * for every mounted selector that rescans a global collection to conclude
 * nothing changed for it. `useShallow` suppresses the *re-render*, never the
 * selector body, so it does not help here.
 *
 * Scale is Jinjing's live 1.4.203-hourly capture: ~870 workspaces, ~1,400
 * terminal tabs, ~857 sleeping-agent records, ~177 agent-status rows, 20
 * mounted panes/cards.
 *
 * Measured on `main` for ONE `setRuntimePaneTitle` call at that scale:
 *   sleeping-agent record reads : 19_711 — 23 executions of
 *     `selectSleepingRecordParkExemptTabIds` x 857 records. 20 come from
 *     zustand notifying each mounted worktree's subscriber; 3 more from React
 *     re-running the selector while rendering the components that did change.
 *   agent-status row reads      :      0 — the tab-bar and sidebar summary
 *     projections are already gated on their source slice identities.
 * After this ticket both must be 0: the write changes `runtimePaneTitlesByTabId`
 * only, so no global inventory may be walked.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { selectTabBarAgentProjections } from '@/components/tab-bar/tab-agent-types-by-tab-id'
import { useWorktreeActivityStatus } from '@/components/sidebar/use-worktree-activity-status'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { useTerminalTabColdParking } from './use-terminal-tab-cold-parking'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const WORKSPACE_COUNT = 870
const TERMINAL_TAB_COUNT = 1408
const SLEEPING_RECORD_COUNT = 857
const AGENT_STATUS_COUNT = 177
/** "Live or mounted panes: 20–28" in the capture. */
const MOUNTED_WORKTREE_COUNT = 20

/** What one title update cost on `main`, so a regression reads as a number. */
const MAIN_SLEEPING_RECORD_READS = 19_711

const reads = { sleepingRecords: 0, agentStatusRows: 0 }

/** Counts every value read, so a `for…in`/`Object.values` walk is visible without touching production code. */
function countingRecord<T>(
  entries: readonly (readonly [string, T])[],
  counter: 'sleepingRecords' | 'agentStatusRows'
): Record<string, T> {
  const map: Record<string, T> = {}
  for (const [key, value] of entries) {
    Object.defineProperty(map, key, {
      enumerable: true,
      configurable: true,
      get: () => {
        reads[counter] += 1
        return value
      }
    })
  }
  return map
}

const worktreeIds = Array.from(
  { length: WORKSPACE_COUNT },
  (_, index) => `repo-1::/repo/wt-${index}`
)
const mountedWorktreeIds = worktreeIds.slice(0, MOUNTED_WORKTREE_COUNT)
/** The pane that receives the title update, on the first mounted workspace. */
const TARGET_WORKTREE_ID = mountedWorktreeIds[0]
const TARGET_TAB_ID = 'tab-0-0'
const TARGET_PANE_ID = 1

function buildTabsByWorktree(): Record<string, TerminalTab[]> {
  const tabsByWorktree: Record<string, TerminalTab[]> = {}
  let remaining = TERMINAL_TAB_COUNT
  for (const [index, worktreeId] of worktreeIds.entries()) {
    const count = Math.min(remaining, index < MOUNTED_WORKTREE_COUNT ? 4 : 2)
    remaining -= count
    tabsByWorktree[worktreeId] = Array.from({ length: count }, (_, tabIndex) => ({
      id: `tab-${index}-${tabIndex}`,
      ptyId: `${worktreeId}@@pty-${tabIndex}`,
      worktreeId,
      title: `tab ${tabIndex}`,
      customTitle: null,
      color: null,
      sortOrder: tabIndex,
      createdAt: 0
    }))
    if (remaining <= 0) {
      break
    }
  }
  return tabsByWorktree
}

const tabsByWorktree = buildTabsByWorktree()
const seededTerminalTabs = Object.values(tabsByWorktree).flat()

function buildSleepingRecords(): Record<string, SleepingAgentSessionRecord> {
  return countingRecord(
    Array.from({ length: SLEEPING_RECORD_COUNT }, (_, index) => {
      const worktreeId = worktreeIds[index % WORKSPACE_COUNT]
      const tabId = tabsByWorktree[worktreeId]?.[0]?.id ?? `tab-${index}-0`
      const paneKey = `${tabId}:1`
      const record: SleepingAgentSessionRecord = {
        paneKey,
        tabId,
        worktreeId,
        agent: 'claude',
        providerSession: { key: 'session_id', id: `session-${index}` },
        prompt: 'prompt',
        state: 'working',
        capturedAt: 1,
        updatedAt: 1
      }
      return [paneKey, record] as const
    }),
    'sleepingRecords'
  )
}

function buildAgentStatuses(): Record<string, AgentStatusEntry> {
  const now = Date.now()
  return countingRecord(
    Array.from({ length: AGENT_STATUS_COUNT }, (_, index) => {
      const tabId = seededTerminalTabs[index % seededTerminalTabs.length].id
      const paneKey = `${tabId}:1`
      const entry: AgentStatusEntry = {
        paneKey,
        state: 'working',
        prompt: 'prompt',
        updatedAt: now,
        stateStartedAt: now,
        stateHistory: [],
        agentType: 'claude'
      }
      return [paneKey, entry] as const
    }),
    'agentStatusRows'
  )
}

const originalState = useAppStore.getState()
let container: HTMLDivElement | null = null
let root: Root | null = null

const EMPTY_ASSIGNMENTS = new Map<string, { groupId: string; isActiveInGroup: boolean }>()

/** The three consumers STA-7552 names, mounted per retained workspace. */
function MountedWorkspaceProbe({ worktreeId }: { worktreeId: string }): null {
  useTerminalTabColdParking({
    worktreeId,
    terminalTabs: tabsByWorktree[worktreeId] ?? [],
    assignments: EMPTY_ASSIGNMENTS,
    isWorktreeActive: worktreeId === TARGET_WORKTREE_ID,
    activeTerminalTabId: null,
    coldParkTerminalPanes: false,
    shouldMeasureHiddenWorktree: false,
    activityTerminalPortals: [],
    activationDeferredMountTabIds: null
  })
  useWorktreeActivityStatus(worktreeId)
  useAppStore(useShallow(selectTabBarAgentProjections))
  return null
}

function mountAtCaptureScale(): void {
  useAppStore.setState({
    tabsByWorktree,
    sleepingAgentSessionsByPaneKey: buildSleepingRecords(),
    agentStatusByPaneKey: buildAgentStatuses(),
    agentStatusEpoch: 1,
    activeWorktreeId: TARGET_WORKTREE_ID,
    runtimePaneTitlesByTabId: { [TARGET_TAB_ID]: { [TARGET_PANE_ID]: 'initial title' } }
  })

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <>
        {mountedWorktreeIds.map((worktreeId) => (
          <MountedWorkspaceProbe key={worktreeId} worktreeId={worktreeId} />
        ))}
      </>
    )
  )
}

function applyOnePaneTitleUpdate(title: string): void {
  act(() => {
    useAppStore.getState().setRuntimePaneTitle(TARGET_TAB_ID, TARGET_PANE_ID, title)
  })
}

beforeEach(() => {
  reads.sleepingRecords = 0
  reads.agentStatusRows = 0
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  container?.remove()
  container = null
  useAppStore.setState(originalState, true)
})

describe('one pane title update at live-capture scale', () => {
  it('walks no global inventory', () => {
    mountAtCaptureScale()
    reads.sleepingRecords = 0
    reads.agentStatusRows = 0

    applyOnePaneTitleUpdate('next title')

    expect(reads.sleepingRecords).toBe(0)
    expect(reads.agentStatusRows).toBe(0)
    expect(MAIN_SLEEPING_RECORD_READS).toBe(SLEEPING_RECORD_COUNT * 23)
  })

  it('stays flat as unrelated workspaces accumulate', () => {
    mountAtCaptureScale()
    reads.sleepingRecords = 0
    applyOnePaneTitleUpdate('title a')
    const firstUpdateReads = reads.sleepingRecords

    reads.sleepingRecords = 0
    applyOnePaneTitleUpdate('title b')

    // Why a ratio and not just 0: this is what "independent of stored scale" means.
    expect(reads.sleepingRecords).toBe(firstUpdateReads)
    expect(reads.sleepingRecords).toBeLessThan(SLEEPING_RECORD_COUNT)
  })

  it('still rescans when the sleeping-record inventory itself changes', () => {
    mountAtCaptureScale()
    reads.sleepingRecords = 0

    act(() => {
      useAppStore.setState({ sleepingAgentSessionsByPaneKey: buildSleepingRecords() })
    })

    // Why: correctness floor — a real inventory change must still be observed.
    expect(reads.sleepingRecords).toBeGreaterThanOrEqual(SLEEPING_RECORD_COUNT)
  })
})
