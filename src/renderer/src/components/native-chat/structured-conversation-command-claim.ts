// One conversation command per session at a time, resolved against the command's own terminal frame.
//
// A conversation command runs on the host long after the request that started it; the reply is a
// receipt, not a completion. So the claim below waits for the frame the host revises when the
// command finishes -- carried on the session's own journal stream -- and treats the reply as one way
// that frame can be learned rather than as the answer itself. When neither arrives inside the
// deadline the claim does not disappear: it becomes a marker that refuses the next attempt, because
// elapsed time is not evidence the first attempt stopped. The marker retires when the frame lands
// late, when the session restarts, or when the user interrupts.

import {
  isAgentSessionConversationCommandResult,
  type AgentSessionConversationCommand,
  type AgentSessionConversationCommandResult
} from '../../../../shared/agent-session-conversation-command'
import { agentJournalSubmissionKey } from '../../../../shared/agent-session-journal-item-key'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import { readAgentJournalTurn } from '../../../../shared/agent-session-turn-record'
import { translate } from '@/i18n/i18n'

/** The host settles a compaction on the provider's terminal frame inside its own 180s window
 *  (`structured-session-compaction.ts`). A client that gave up sooner would call a command
 *  unresolved while the host still knew the answer. */
export const CONVERSATION_COMMAND_DEADLINE_MS = 195_000

export type ConversationCommandOutcome = { accepted: boolean; error: string | null }
type ConversationCommandClaimOutcome = ConversationCommandOutcome & { retrySameOperation?: true }

/** What the host said, as far as the client can tell. `unresolved` means the reply never arrived,
 *  which leaves the command possibly still running. */
export type ConversationCommandReply = {
  result: AgentSessionConversationCommandResult | null
  unresolved: boolean
}

type Obligation = {
  command: AgentSessionConversationCommand
  operationId: string
  /** The journal item the host revises when the command reaches its terminal frame. Compaction
   *  only: a clear writes no journal item, so it has nothing on the stream to wait for. */
  terminalItemId: string | null
}

type LiveClaim = Obligation & {
  deadline: ReturnType<typeof setTimeout>
  settle: (outcome: ConversationCommandClaimOutcome) => void
  onLateReply: () => void
}

const COMPACTION_COMPLETED = 'Conversation compacted.'
const COMPACTION_UNCONFIRMED = 'Compaction completion is unconfirmed.'

function runningMessage(): string {
  return translate(
    'components.native-chat.conversationCommand.running',
    'Wait for the conversation operation to finish.'
  )
}

function unresolvedMessage(command: AgentSessionConversationCommand): string {
  return translate(
    'components.native-chat.conversationCommand.mayStillBeRunning',
    'The previous /{{value0}} may still be running. Restart the session before running it again.',
    { value0: command }
  )
}

function pendingWorkMessage(): string {
  return translate(
    'components.native-chat.conversationCommand.pendingWork',
    'Wait for pending work and messages to finish before using this command.'
  )
}

function unconfirmedMessage(): string {
  return translate(
    'components.native-chat.conversationCommand.unconfirmed',
    'Conversation operation was not confirmed.'
  )
}

/** The command row is a keyed host projection. Keep old-host unconfirmed rows pending, and preserve
 *  provider failures instead of turning every non-running revision into success. */
function terminalFrameOutcome(
  items: readonly AgentJournalRenderItem[],
  itemId: string | null
): ConversationCommandOutcome | null {
  if (itemId === null) {
    return null
  }
  const item = items.find((entry) => entry.itemId === itemId)
  if (
    item?.body.kind !== 'status' ||
    readAgentJournalTurn(item.body)?.state === 'running' ||
    item.body.text === COMPACTION_UNCONFIRMED
  ) {
    return null
  }
  return item.body.text === COMPACTION_COMPLETED
    ? { accepted: true, error: null }
    : { accepted: false, error: item.body.text }
}

/** A reply the host could not confirm; the operation id must stay reusable for the same attempt. */
export function isUnconfirmedConversationCommand(method: string, value: unknown): boolean {
  return (
    method === 'agentSession.conversationCommand' &&
    isAgentSessionConversationCommandResult(value) &&
    value.state === 'unknown'
  )
}

export class StructuredConversationCommandClaim {
  private live: LiveClaim | null = null
  private unresolved: Obligation | null = null

  constructor(private readonly deadlineMs: number = CONVERSATION_COMMAND_DEADLINE_MS) {}

  /** A command is outstanding; sends stay blocked until it settles. */
  get isRunning(): boolean {
    return this.live !== null
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
    if (this.live) {
      return Promise.resolve({ accepted: false, error: runningMessage() })
    }
    if (this.unresolved) {
      return Promise.resolve({ accepted: false, error: unresolvedMessage(this.unresolved.command) })
    }
    if (input.blocked) {
      return Promise.resolve({ accepted: false, error: pendingWorkMessage() })
    }
    const { promise, resolve } = Promise.withResolvers<ConversationCommandClaimOutcome>()
    const claim: LiveClaim = {
      command: input.command,
      operationId: input.operationId,
      terminalItemId:
        input.command === 'compact'
          ? agentJournalSubmissionKey(`compact:${input.operationId}`)
          : null,
      deadline: setTimeout(() => this.expire(claim), this.deadlineMs),
      settle: resolve,
      onLateReply: input.onLateReply ?? (() => {})
    }
    this.live = claim
    void input.send().then(
      (reply) => this.applyReply(claim, reply),
      // A thrown send is the same as no reply: the request may still be running.
      () => {}
    )
    return promise
  }

  /** Fold in one snapshot of the session's own stream. Returns true when host truth retired work. */
  applyStreamSnapshot(items: readonly AgentJournalRenderItem[]): boolean {
    const liveOutcome = this.live ? terminalFrameOutcome(items, this.live.terminalItemId) : null
    if (this.live && liveOutcome) {
      this.finish(this.live, liveOutcome)
      return true
    }
    if (this.unresolved && terminalFrameOutcome(items, this.unresolved.terminalItemId) !== null) {
      this.unresolved = null
      return true
    }
    return false
  }

  /** A restart or an interrupt supersedes the obligation: nothing is owed any more. */
  reset(retryPreparedClear = false): void {
    if (this.live) {
      this.finish(this.live, {
        accepted: false,
        error: unconfirmedMessage(),
        ...(retryPreparedClear && this.live.command === 'clear'
          ? { retrySameOperation: true as const }
          : {})
      })
    }
    this.unresolved = null
  }

  private applyReply(claim: LiveClaim, reply: ConversationCommandReply): void {
    if (reply.unresolved || reply.result?.state === 'unknown') {
      // The host either never answered or answered that it cannot confirm. Either way the frame,
      // not the reply, decides.
      return
    }
    if (this.unresolved?.operationId === claim.operationId) {
      this.unresolved = null
      claim.onLateReply()
      return
    }
    this.finish(
      claim,
      reply.result
        ? { accepted: !reply.result.error, error: reply.result.error ?? null }
        : { accepted: false, error: unconfirmedMessage() }
    )
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
    this.unresolved = {
      command: claim.command,
      operationId: claim.operationId,
      terminalItemId: claim.terminalItemId
    }
    claim.settle({
      accepted: false,
      error: unresolvedMessage(claim.command),
      retrySameOperation: true
    })
  }
}
