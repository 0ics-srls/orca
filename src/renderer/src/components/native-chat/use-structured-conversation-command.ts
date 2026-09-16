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
  onReconciled: (operationId: string) => void
}): {
  run: (command: AgentSessionConversationCommand) => Promise<ConversationCommandOutcome>
  isRunning: () => boolean
  retire: () => void
} {
  const { blocked, fence, items, mutate, onReconciled, sessionId } = args
  const claim = useRef(new StructuredConversationCommandClaim())
  const operationIds = useRef(new Map<AgentSessionConversationCommand, string>())

  useEffect(() => {
    const operationId =
      operationIds.current.get('compact') ?? operationIds.current.get('clear') ?? null
    if (claim.current.applyStreamSnapshot(items)) {
      operationIds.current.clear()
      if (operationId) {
        onReconciled(operationId)
      }
    }
  }, [items, onReconciled])

  // A restart supersedes whatever the previous fence still owed.
  useEffect(() => {
    const current = claim.current
    const ids = operationIds.current
    return () => {
      ids.delete('compact')
      current.reset(true)
    }
  }, [fence])

  useEffect(() => {
    const current = claim.current
    const ids = operationIds.current
    return () => {
      ids.clear()
      current.reset()
    }
  }, [sessionId])

  return {
    run: (command) => {
      if (claim.current.hasObligation) {
        return claim.current.run({
          command,
          operationId: '',
          blocked,
          send: async () => ({ result: null, unresolved: false })
        })
      }
      // Minted here, not inside `mutate`: the claim needs the id to know which journal item carries
      // this command's terminal frame.
      const operationId = operationIds.current.get(command) ?? structuredSessionOperationId()
      operationIds.current.set(command, operationId)
      return claim.current
        .run({
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
            if (!claim.current.isOperationOutstanding(operationId)) {
              onReconciled(operationId)
            }
            return { result, unresolved }
          },
          onLateReply: () => {
            if (operationIds.current.get(command) === operationId) {
              operationIds.current.delete(command)
            }
            onReconciled(operationId)
          }
        })
        .then(({ retrySameOperation, ...outcome }) => {
          if (!retrySameOperation && operationIds.current.get(command) === operationId) {
            operationIds.current.delete(command)
            onReconciled(operationId)
          }
          return outcome
        })
    },
    isRunning: () => claim.current.isRunning,
    retire: () => {
      operationIds.current.clear()
      claim.current.reset()
    }
  }
}
