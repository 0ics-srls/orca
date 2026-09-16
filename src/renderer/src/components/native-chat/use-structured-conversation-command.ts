// The session hook's half of a conversation command: it owns the claim, feeds it the session's own
// stream, and retires it when the session restarts.

import { useEffect, useLayoutEffect, useRef } from 'react'
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
import {
  structuredAgentSessionMutationScope,
  type StructuredAgentSessionMutateWithDisposition
} from './use-structured-agent-session-mutate'
import { structuredSessionOperationId } from './use-structured-agent-session-outbox'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'

export function useStructuredConversationCommand(args: {
  sessionId: string
  target: RuntimeClientTarget
  fence: number | null
  items: readonly AgentJournalRenderItem[]
  /** Work the command would have to interrupt; the host refuses in that state anyway. */
  blocked: boolean
  mutate: StructuredAgentSessionMutateWithDisposition
  onReconciled: (operationId: string) => void
}): {
  run: (command: AgentSessionConversationCommand) => Promise<ConversationCommandOutcome>
  isRunning: () => boolean
  retire: () => void
} {
  const { blocked, fence, items, mutate, onReconciled, sessionId, target } = args
  const claim = useRef(new StructuredConversationCommandClaim())
  const operationIds = useRef(new Map<AgentSessionConversationCommand, string>())
  const requestScope = structuredAgentSessionMutationScope(target, sessionId)

  useEffect(() => {
    const settledOperationIds = claim.current.applyStreamSnapshot(items)
    for (const operationId of settledOperationIds) {
      for (const [command, candidate] of operationIds.current) {
        if (candidate === operationId) {
          operationIds.current.delete(command)
        }
      }
      onReconciled(operationId)
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

  useLayoutEffect(() => {
    const current = claim.current
    const ids = operationIds.current
    return () => {
      ids.clear()
      current.reset()
    }
  }, [requestScope])

  return {
    run: (command) => {
      if (claim.current.isRunning) {
        return claim.current.run({
          command,
          operationId: '',
          blocked,
          send: async () => ({ status: 'refused', error: null })
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
            const disposition = await mutate<AgentSessionConversationCommandResult>(
              'agentSession.conversationCommand',
              'agentSession.conversationCommand',
              { command },
              { operationId }
            )
            if (!claim.current.isOperationOutstanding(operationId)) {
              onReconciled(operationId)
            }
            if (disposition.status === 'unresolved') {
              return { status: 'unresolved' }
            }
            if (disposition.status === 'refused') {
              return { status: 'refused', error: disposition.message }
            }
            return disposition.value.state === 'unknown'
              ? { status: 'unresolved' }
              : { status: 'completed', result: disposition.value }
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
