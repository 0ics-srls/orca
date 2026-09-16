import type { AgentSessionRecord } from '../../../shared/agent-session-record'

/**
 * A session's mutations serialize on one lane keyed by session id. A conversation command holds that
 * lane for as long as it waits on the provider's terminal frame, so the controls a user can always
 * reach -- interrupt, cancel, close -- take a lane of their own while that wait is outstanding.
 * Closing is what stops the provider child, which is what ends the wait; parking it behind the wait
 * makes the escape depend on the thing it escapes.
 */
export function structuredAgentSessionControlLane(sessionId: string): string {
  return `session-control:${sessionId}`
}

/**
 * Re-derived from the durable record, never timed: only compaction holds the main lane across a
 * provider round trip. Clear stays serialized with close because it creates and commits a
 * replacement before the source may be retired.
 */
export function structuredAgentSessionMainLaneParked(
  record: Pick<AgentSessionRecord, 'conversationCommand'> | null | undefined
): boolean {
  const command = record?.conversationCommand
  return (
    command?.command === 'compact' && command.phase === 'prepared' && command.state === 'unknown'
  )
}

/** The lane a user control should run on: its own while a command parks the main one, else the main one. */
export function structuredAgentSessionControlLaneFor(
  sessionId: string,
  record: Pick<AgentSessionRecord, 'conversationCommand'> | null | undefined,
  liveMainLaneParked?: boolean
): string {
  return (liveMainLaneParked ?? structuredAgentSessionMainLaneParked(record))
    ? structuredAgentSessionControlLane(sessionId)
    : sessionId
}
