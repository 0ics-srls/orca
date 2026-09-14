import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import type { AgentJournalItemIdentity } from '../../shared/agent-session-journal-types'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import type { ClaudeStructuredSessionEvent } from './claude-structured-session-state'
import {
  claudeApprovalItem,
  claudePromptIdentity,
  claudeQuestionItems
} from './claude-structured-prompt-items'

export function appendClaudePromptJournalItems(input: {
  event: Extract<ClaudeStructuredSessionEvent, { type: 'prompt' }>
  sink: StructuredAgentSessionEventSink
  bindPromptItemId?: (journalItemId: string, promptKey: string, questionId?: string) => void
}): AgentJournalItemIdentity[] {
  const identities: AgentJournalItemIdentity[] = []
  const { event, sink, bindPromptItemId } = input
  if (event.prompt.kind === 'question') {
    for (const question of claudeQuestionItems({
      sessionId: event.sessionId,
      prompt: event.prompt
    })) {
      identities.push(question.identity)
      sink.appendItem(question.identity, question.body)
      bindPromptItemId?.(agentJournalItemKey(question.identity), event.prompt.promptKey)
    }
    return identities
  }
  const identity = claudePromptIdentity({
    sessionId: event.sessionId,
    promptKey: event.prompt.promptKey
  })
  identities.push(identity)
  sink.appendItem(identity, claudeApprovalItem(event.prompt))
  bindPromptItemId?.(agentJournalItemKey(identity), event.prompt.promptKey)
  return identities
}
