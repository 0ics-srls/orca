// The session's current thread goal, derived from the journal rather than stored
// beside it. The latest goal transition in journal order is the whole answer.

import { isRootAgentJournalItem } from './agent-session-journal-producer'
import {
  AGENT_JOURNAL_THREAD_GOAL_STATUSES,
  type AgentJournalItemBody,
  type AgentJournalRenderItem,
  type AgentJournalThreadGoal,
  type AgentJournalThreadGoalStatus
} from './agent-session-journal-types'

const GOAL_FRAME_KINDS = new Set([
  'notification:thread/goal/updated',
  'notification:thread/goal/cleared'
])

type GoalCandidate = Pick<AgentJournalRenderItem, 'sequence' | 'body' | 'agentId'>

export function isAgentJournalThreadGoalStatus(
  value: string
): value is AgentJournalThreadGoalStatus {
  return AGENT_JOURNAL_THREAD_GOAL_STATUSES.some((status) => status === value)
}

/** Whether a provider frame reports a goal transition. */
export function isAgentSessionThreadGoalFrame(
  frame: { provider: string; kind: string } | undefined
): boolean {
  return frame?.provider === 'codex' && GOAL_FRAME_KINDS.has(frame.kind)
}

/** Whether a row records a goal transition. Rows written before the typed
 *  snapshot existed are still recognized by their frame. */
export function isAgentJournalThreadGoalRow(body: AgentJournalItemBody): boolean {
  return (
    body.kind === 'status' &&
    (body.threadGoal !== undefined || isAgentSessionThreadGoalFrame(body.providerFrame))
  )
}

function goalFromRow(body: AgentJournalItemBody): AgentJournalThreadGoal | null {
  if (body.kind !== 'status' || body.threadGoal?.state !== 'set') {
    // Cleared, an unknown state, or a legacy row whose payload may be truncated.
    return null
  }
  return isAgentJournalThreadGoalStatus(body.threadGoal.goal.status) ? body.threadGoal.goal : null
}

/**
 * The current goal as far as these rows can tell: `undefined` when none of them
 * records a goal transition, otherwise the latest one's goal, or null when it
 * cleared the goal or cannot be read.
 */
export function currentAgentSessionThreadGoal(
  items: Iterable<GoalCandidate>
): AgentJournalThreadGoal | null | undefined {
  let latest: GoalCandidate | null = null
  for (const item of items) {
    if (
      isRootAgentJournalItem(item) &&
      isAgentJournalThreadGoalRow(item.body) &&
      (latest === null || item.sequence > latest.sequence)
    ) {
      latest = item
    }
  }
  return latest === null ? undefined : goalFromRow(latest.body)
}

/** Goal statuses that still describe work in progress, so readers keep them in view. */
export function isAgentSessionThreadGoalOpen(goal: AgentJournalThreadGoal | null): boolean {
  return goal !== null && goal.status !== 'complete'
}

/**
 * Seconds of goal work. The provider's `timeUsedSeconds` is exact as of `updatedAt`;
 * only an active goal with a turn running accrues more, counted from whichever of
 * that report and the turn's start is later.
 */
export function agentSessionThreadGoalElapsedSeconds(
  goal: AgentJournalThreadGoal,
  now: number,
  runningTurn: { startedAt: number | null } | null
): number {
  const reported = Math.max(0, goal.timeUsedSeconds)
  if (goal.status !== 'active' || runningTurn === null) {
    return reported
  }
  const since = Math.max(goal.updatedAt, runningTurn.startedAt ?? goal.updatedAt)
  return reported + Math.max(0, Math.floor((now - since) / 1000))
}
