import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity
} from '../../shared/agent-session-journal-types'
import { backgroundTaskFallbackText } from '../../shared/native-chat-background-task-row'
import type { NativeChatBackgroundTaskBlock } from '../../shared/native-chat-types'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import type { ClaudeBackgroundTaskRow } from './claude-background-task-row-lifecycle'

/** Durable identity for one RUN of a task.
 *
 *  A provider may reuse a task id for a distinct later invocation, and a row
 *  keyed by the id alone would overwrite the first run's transcript history
 *  instead of leaving it standing beside the restart. The generation suffix
 *  separates them. Generation 1 carries no suffix, so every row written before
 *  generations existed keeps the key it already has. */
export function claudeBackgroundTaskIdentity(
  taskId: string,
  generation = 1
): AgentJournalItemIdentity {
  const key =
    generation > 1
      ? `claude-background-task:${taskId}#${generation}`
      : `claude-background-task:${taskId}`
  return { provider: 'orca', clientMessageId: key }
}

export function claudeBackgroundTaskBody(
  block: NativeChatBackgroundTaskBlock
): AgentJournalItemBody {
  return {
    kind: 'message',
    role: 'system',
    blocks: [{ type: 'text', text: backgroundTaskFallbackText(block) }, { ...block }]
  }
}

export function writeClaudeBackgroundTaskRow(
  sink: StructuredAgentSessionEventSink,
  id: string,
  row: ClaudeBackgroundTaskRow
): void {
  const body = claudeBackgroundTaskBody(row.block)
  const serialized = JSON.stringify(body)
  if (serialized === row.lastSerialized) {
    return
  }
  row.lastSerialized = serialized
  const identity = claudeBackgroundTaskIdentity(id, row.generation)
  sink.appendItem(identity, body, {
    // Keyed per RUN, not per task: sharing one key across generations would let
    // a restart's queued append evict the finished run's final revision.
    coalescingKey: identity.provider === 'orca' ? identity.clientMessageId : `task:${id}`
  })
  sink.publish()
}
