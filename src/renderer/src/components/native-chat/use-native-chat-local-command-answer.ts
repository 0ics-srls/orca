import { useCallback } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { deriveNativeChatContextUsage } from '../../../../shared/native-chat-context-usage'
import { nativeChatLocalCommand } from '../../../../shared/native-chat-local-commands'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { formatNativeChatContextUsageAnswer } from './native-chat-context-usage-answer'

/** Answers the commands the chat host owns over a terminal session. Claude's
 *  `/context` paints a grid the chat never sees, so the host replies with the
 *  same estimate the CLI's statusline shows. */
export function useNativeChatLocalCommandAnswer(
  agent: AgentType,
  messages: readonly NativeChatMessage[]
): (command: string) => string | null {
  return useCallback(
    (command: string): string | null =>
      nativeChatLocalCommand(agent, command) === 'context'
        ? formatNativeChatContextUsageAnswer(deriveNativeChatContextUsage(messages, agent))
        : null,
    [agent, messages]
  )
}
