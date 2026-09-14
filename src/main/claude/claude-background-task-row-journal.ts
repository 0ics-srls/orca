import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity
} from '../../shared/agent-session-journal-types'
import { backgroundTaskFallbackText } from '../../shared/native-chat-background-task-row'
import type { NativeChatBackgroundTaskBlock } from '../../shared/native-chat-types'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import type { ClaudeBackgroundTaskRow } from './claude-background-task-row-lifecycle'

export function claudeBackgroundTaskIdentity(taskId: string): AgentJournalItemIdentity {
  return { provider: 'orca', clientMessageId: `claude-background-task:${taskId}` }
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
  sink.appendItem(claudeBackgroundTaskIdentity(id), body, {
    coalescingKey: `claude-background-task:${id}`
  })
  sink.publish()
}
