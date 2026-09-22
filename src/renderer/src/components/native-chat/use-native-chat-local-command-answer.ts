import { useCallback } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { deriveNativeChatContextUsage } from '../../../../shared/native-chat-context-usage'
import { nativeChatLocalCommand } from '../../../../shared/native-chat-local-commands'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import {
  formatNativeChatContextUsageAnswer,
  formatNativeChatContextUsageUnreported
} from './native-chat-context-usage-answer'

/** The context window the host's model listing states for a model id, or null. */
export type NativeChatModelContextWindow = (modelId: string) => number | null

/** Answers a command the chat host owns over a terminal session, or null to send it. */
export type NativeChatLocalCommandAnswer = (
  command: string,
  contextWindowTokens: NativeChatModelContextWindow
) => string | null

/** OMP's `/context` paints a panel the chat never sees, so the host replies from the
 *  prompt size the last response reported, against the window of the model that
 *  served it. */
export function answerNativeChatLocalCommand(args: {
  agent: AgentType
  command: string
  messages: readonly NativeChatMessage[]
  contextWindowTokens: NativeChatModelContextWindow
}): string | null {
  if (nativeChatLocalCommand(args.agent, args.command) !== 'context') {
    return null
  }
  if (!sessionReportsUsage(args.messages)) {
    return formatNativeChatContextUsageUnreported()
  }
  const usage = deriveNativeChatContextUsage(args.messages, (message) => {
    // Why: OMP's listing keys models by `provider/model`; several providers share a bare id.
    const selector =
      message.provider && message.model ? `${message.provider}/${message.model}` : null
    return selector ? args.contextWindowTokens(selector) : null
  })
  return formatNativeChatContextUsageAnswer(usage)
}

/** False when the agent has answered yet no answer names its model: a host that
 *  predates usage decoding, or a scraped view, will never report usage. */
function sessionReportsUsage(messages: readonly NativeChatMessage[]): boolean {
  let answered = false
  for (const message of messages) {
    if (message.role !== 'assistant' || message.source === 'hook') {
      continue
    }
    if (message.model !== undefined) {
      return true
    }
    answered = true
  }
  return !answered
}

export function useNativeChatLocalCommandAnswer(
  agent: AgentType,
  { messages }: { messages: readonly NativeChatMessage[] }
): NativeChatLocalCommandAnswer {
  return useCallback(
    (command, contextWindowTokens) =>
      answerNativeChatLocalCommand({ agent, command, messages, contextWindowTokens }),
    [agent, messages]
  )
}
