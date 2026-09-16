// The session hook's half of a conversation command: it owns the claim, feeds it the session's own
// stream, and retires it when the session restarts.

import { useEffect, useRef } from 'react'
import type {
  AgentSessionConversationCommand,
  AgentSessionConversationCommandResult
} from '../../../../shared/agent-session-conversation-command'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import {
  StructuredConversationCommandClaim,
  type ConversationCommandOutcome,
  type ConversationCommandReply
} from './structured-conversation-command-claim'
import type { StructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import { structuredSessionOperationId } from './use-structured-agent-session-outbox'

export function useStructuredConversationCommand(args: {
  sessionId: string
  fence: number | null
  items: readonly AgentJournalRenderItem[]
  /** Work the command would have to interrupt; the host refuses in that state anyway. */
  blocked: boolean
  mutate: StructuredAgentSessionMutate
}): {
  run: (command: AgentSessionConversationCommand) => Promise<ConversationCommandOutcome>
  isRunning: () => boolean
  retire: () => void
} {
  const { blocked, fence, items, mutate, sessionId } = args
  const claim = useRef(new StructuredConversationCommandClaim())

  useEffect(() => {
    claim.current.applyStreamSnapshot(items)
  }, [items])

  // A restart supersedes whatever the previous fence still owed.
  useEffect(() => {
    const current = claim.current
    return () => current.reset()
  }, [sessionId, fence])

  return {
    run: (command) => {
      // Minted here, not inside `mutate`: the claim needs the id to know which journal item carries
      // this command's terminal frame.
      const operationId = structuredSessionOperationId()
      return claim.current.run({
        command,
        operationId,
        blocked,
        send: async (): Promise<ConversationCommandReply> => {
          let unresolved = false
          const result = await mutate<AgentSessionConversationCommandResult>(
            'agentSession.conversationCommand',
            'agentSession.conversationCommand',
            { command },
            {
              operationId,
              onUnresolved: () => {
                unresolved = true
              }
            }
          )
          return { result, unresolved }
        }
      })
    },
    isRunning: () => claim.current.isRunning,
    retire: () => claim.current.reset()
  }
}
