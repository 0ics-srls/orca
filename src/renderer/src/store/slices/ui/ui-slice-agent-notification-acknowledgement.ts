import type { AppState } from '../../types'
import { buildAgentNotificationId } from '../../../../../shared/agent-notification-id'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'

export function resolvePaneKeyWorktreeIdFromTabs(state: AppState, paneKey: string): string | null {
  const parsed = parsePaneKey(paneKey)
  if (!parsed) {
    return null
  }
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree ?? {})) {
    if (tabs.some((tab) => tab.id === parsed.tabId)) {
      return worktreeId
    }
  }
  return null
}

/** An agent row's turn starts: the episode it is in, plus the ones it has already left. */
type AgentTurnEpisodes = {
  stateStartedAt?: number
  stateHistory?: { startedAt?: number }[]
}

function agentTurnEpisodeStarts(entry: AgentTurnEpisodes): number[] {
  return [entry.stateStartedAt, ...(entry.stateHistory ?? []).map((history) => history.startedAt)]
    .map(usableTimestamp)
    .filter((startedAt) => startedAt > 0)
}

/**
 * Every notification id this row can have raised since the last acknowledgement.
 *
 * Why history and not just the current field: a banner's id is minted from whatever
 * `stateStartedAt` the row carried when it was dispatched, and that field is re-projected as the
 * turn settles — the working episode's start moves into `stateHistory` and the settled start takes
 * its place. A banner raised in the window before that re-projection carries the working start, so
 * reading only the current field would leave it on screen forever. These are the same episodes
 * `latestAgentTurnTimestamp` below already scans for the unread check.
 */
export function collectAcknowledgedAgentNotificationIds({
  ids,
  worktreeId,
  paneKey,
  entry,
  previousAckAt
}: {
  ids: Set<string>
  worktreeId: string | null | undefined
  paneKey: string
  entry: AgentTurnEpisodes
  previousAckAt: number
}): void {
  for (const startedAt of agentTurnEpisodeStarts(entry)) {
    if (previousAckAt >= startedAt) {
      continue
    }
    const id = buildAgentNotificationId({ worktreeId, paneKey, stateStartedAt: startedAt })
    if (id) {
      ids.add(id)
    }
  }
}

export function usableTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Newest turn timestamp an unread check can compare against for one agent row. */
export function latestAgentTurnTimestamp(entry: AgentTurnEpisodes): number {
  let latest = 0
  // Why history too: Activity renders one event per stateHistory entry, each with its own unread check.
  for (const startedAt of agentTurnEpisodeStarts(entry)) {
    latest = Math.max(latest, startedAt)
  }
  return latest
}
