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

type Obligation = {
  command: AgentSessionConversationCommand
  operationId: string
}

type LiveClaim = Obligation & {
  deadline: ReturnType<typeof setTimeout>
  settle: (outcome: ConversationCommandClaimOutcome) => void
  onLateReply: () => void
}

/** The provider's own completion window is 180s. Keep a small margin for host persistence and
 * stream delivery before presenting the command as unresolved. */
export const CONVERSATION_COMMAND_DEADLINE_MS = 195_000

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
  claim: Obligation
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
  private unresolved: Obligation | null = null

  constructor(private readonly deadlineMs = CONVERSATION_COMMAND_DEADLINE_MS) {}

  get isRunning(): boolean {
    return this.live !== null || this.unresolved !== null
  }

  get hasObligation(): boolean {
    return this.live !== null || this.unresolved !== null
  }

  isOperationOutstanding(operationId: string): boolean {
    return this.live?.operationId === operationId || this.unresolved?.operationId === operationId
  }

  run(input: {
    command: AgentSessionConversationCommand
    operationId: string
    blocked: boolean
    send: () => Promise<ConversationCommandReply>
    onLateReply?: () => void
  }): Promise<ConversationCommandClaimOutcome> {
    if (this.live || this.unresolved || input.blocked) {
      return Promise.resolve({
        accepted: false,
        error: this.unresolved
          ? unresolvedMessage(this.unresolved.command)
          : message(
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
      deadline: setTimeout(() => this.expire(claim), this.deadlineMs),
      settle: waiter.resolve,
      onLateReply: input.onLateReply ?? (() => {})
    }
    this.live = claim
    void input.send().then(
      (reply) => this.applyReply(claim, reply),
      () => this.finishUnconfirmed(claim)
    )
    return waiter.promise
  }

  applyStreamSnapshot(items: readonly AgentJournalRenderItem[]): boolean {
    if (this.live) {
      const outcome = terminalFrameOutcome(items, this.live)
      if (!outcome) {
        return false
      }
      this.finish(this.live, outcome)
      return true
    }
    if (this.unresolved) {
      const outcome = terminalFrameOutcome(items, this.unresolved)
      if (outcome) {
        this.unresolved = null
        return true
      }
    }
    return false
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
    this.unresolved = null
  }

  private applyReply(claim: LiveClaim, reply: ConversationCommandReply): void {
    if (this.unresolved?.operationId === claim.operationId) {
      if (!reply.unresolved && reply.result?.state !== 'unknown') {
        this.unresolved = null
        claim.onLateReply()
      }
      return
    }
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
    clearTimeout(claim.deadline)
    this.live = null
    this.unresolved = null
    claim.settle(outcome)
  }

  private expire(claim: LiveClaim): void {
    if (this.live !== claim) {
      return
    }
    this.live = null
    this.unresolved = { command: claim.command, operationId: claim.operationId }
    claim.settle({
      accepted: false,
      error: unresolvedMessage(claim.command),
      retrySameOperation: true
    })
  }
}
