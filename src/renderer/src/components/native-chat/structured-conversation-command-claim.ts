import {
  isAgentSessionConversationCommandResult,
  type AgentSessionConversationCommand,
  type AgentSessionConversationCommandResult
} from '../../../../shared/agent-session-conversation-command'
import { agentJournalSubmissionKey } from '../../../../shared/agent-session-journal-item-key'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import { readAgentJournalTurn } from '../../../../shared/agent-session-turn-record'
import { translate } from '@/i18n/i18n'

export type ConversationCommandOutcome = { accepted: boolean; error: string | null }
export type ConversationCommandClaimOutcome = ConversationCommandOutcome & {
  retrySameOperation?: true
}
export type ConversationCommandReply = {
  result: AgentSessionConversationCommandResult | null
  unresolved: boolean
}

type LiveClaim = {
  command: AgentSessionConversationCommand
  operationId: string
  settle: (outcome: ConversationCommandClaimOutcome) => void
}

function message(key: string, fallback: string): string {
  return translate(`components.native-chat.conversationCommand.${key}`, fallback)
}

function unresolvedMessage(command: AgentSessionConversationCommand): string {
  return translate(
    'components.native-chat.conversationCommand.mayStillBeRunning',
    'The previous /{{value0}} may still be running. Restart the session before running it again.',
    { value0: command }
  )
}

function terminalFrameOutcome(
  items: readonly AgentJournalRenderItem[],
  claim: LiveClaim
): ConversationCommandOutcome | null {
  const item = items.find(
    (entry) => entry.itemId === agentJournalSubmissionKey(`${claim.command}:${claim.operationId}`)
  )
  if (item?.body.kind !== 'status') {
    return null
  }
  const lifecycle = readAgentJournalTurn(item.body)
  if (lifecycle?.state === 'running') {
    return null
  }
  if (
    lifecycle?.state === 'unverifiable' ||
    (lifecycle === null && item.body.text === 'Compaction completion is unconfirmed.')
  ) {
    return { accepted: false, error: unresolvedMessage(claim.command) }
  }
  const completedText =
    claim.command === 'compact' ? 'Conversation compacted.' : 'Conversation cleared.'
  return (lifecycle === null || lifecycle.state === 'completed') && item.body.text === completedText
    ? { accepted: true, error: null }
    : { accepted: false, error: item.body.text }
}

/** A reply the host could not confirm; retries must keep the same durable operation id. */
export function isUnconfirmedConversationCommand(method: string, value: unknown): boolean {
  return (
    method === 'agentSession.conversationCommand' &&
    isAgentSessionConversationCommandResult(value) &&
    value.state === 'unknown'
  )
}

/** Correlates one in-flight request with host lifecycle. Durable ownership remains on the host. */
export class StructuredConversationCommandClaim {
  private live: LiveClaim | null = null

  get isRunning(): boolean {
    return this.live !== null
  }

  get hasObligation(): boolean {
    return this.live !== null
  }

  isOperationOutstanding(operationId: string): boolean {
    return this.live?.operationId === operationId
  }

  run(input: {
    command: AgentSessionConversationCommand
    operationId: string
    blocked: boolean
    send: () => Promise<ConversationCommandReply>
  }): Promise<ConversationCommandClaimOutcome> {
    if (this.live || input.blocked) {
      return Promise.resolve({
        accepted: false,
        error: message(
          this.live ? 'running' : 'pendingWork',
          this.live
            ? 'Wait for the conversation operation to finish.'
            : 'Wait for pending work and messages to finish before using this command.'
        )
      })
    }
    const waiter = Promise.withResolvers<ConversationCommandClaimOutcome>()
    const claim: LiveClaim = {
      command: input.command,
      operationId: input.operationId,
      settle: waiter.resolve
    }
    this.live = claim
    void input.send().then(
      (reply) => this.applyReply(claim, reply),
      () => this.finishUnconfirmed(claim)
    )
    return waiter.promise
  }

  applyStreamSnapshot(items: readonly AgentJournalRenderItem[]): boolean {
    if (!this.live) {
      return false
    }
    const outcome = terminalFrameOutcome(items, this.live)
    if (!outcome) {
      return false
    }
    this.finish(this.live, outcome)
    return true
  }

  reset(retryPreparedClear = false): void {
    if (this.live) {
      this.finish(this.live, {
        accepted: false,
        error: message('unconfirmed', 'Conversation operation was not confirmed.'),
        ...(retryPreparedClear && this.live.command === 'clear'
          ? { retrySameOperation: true as const }
          : {})
      })
    }
  }

  private applyReply(claim: LiveClaim, reply: ConversationCommandReply): void {
    if (reply.result?.state === 'unknown') {
      return
    }
    if (reply.unresolved || !reply.result) {
      this.finishUnconfirmed(claim)
      return
    }
    this.finish(claim, {
      accepted: !reply.result.error,
      error: reply.result.error ?? null
    })
  }

  private finishUnconfirmed(claim: LiveClaim): void {
    this.finish(claim, {
      accepted: false,
      error: message('unconfirmed', 'Conversation operation was not confirmed.'),
      retrySameOperation: true
    })
  }

  private finish(claim: LiveClaim, outcome: ConversationCommandClaimOutcome): void {
    if (this.live !== claim) {
      return
    }
    this.live = null
    claim.settle(outcome)
  }
}
