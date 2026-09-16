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

/** What the host said, as far as the client can tell. `unresolved` means the reply never arrived,
 *  which leaves the command possibly still running. */
export type ConversationCommandReply = {
  result: AgentSessionConversationCommandResult | null
  unresolved: boolean
}

type Obligation = {
  command: AgentSessionConversationCommand
  /** The journal item the host revises when the command reaches its terminal frame. Compaction
   *  only: a clear writes no journal item, so it has nothing on the stream to wait for. */
  terminalItemId: string | null
}

type LiveClaim = Obligation & {
  deadline: ReturnType<typeof setTimeout>
  settle: (outcome: ConversationCommandOutcome) => void
}

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

/** The host drops the running lifecycle from the command's item when it finishes, so the frame is
 *  terminal once the item is present and no longer reports a running turn. */
function reachedTerminalFrame(
  items: readonly AgentJournalRenderItem[],
  itemId: string | null
): boolean {
  if (itemId === null) {
    return false
  }
  const item = items.find((entry) => entry.itemId === itemId)
  return item !== undefined && readAgentJournalTurn(item.body)?.state !== 'running'
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

  run(input: {
    command: AgentSessionConversationCommand
    operationId: string
    blocked: boolean
    send: () => Promise<ConversationCommandReply>
  }): Promise<ConversationCommandOutcome> {
    if (this.live) {
      return Promise.resolve({ accepted: false, error: runningMessage() })
    }
    if (this.unresolved) {
      return Promise.resolve({ accepted: false, error: unresolvedMessage(this.unresolved.command) })
    }
    if (input.blocked) {
      return Promise.resolve({ accepted: false, error: pendingWorkMessage() })
    }
    const { promise, resolve } = Promise.withResolvers<ConversationCommandOutcome>()
    const claim: LiveClaim = {
      command: input.command,
      terminalItemId:
        input.command === 'compact'
          ? agentJournalSubmissionKey(`compact:${input.operationId}`)
          : null,
      deadline: setTimeout(() => this.expire(claim), this.deadlineMs),
      settle: resolve
    }
    this.live = claim
    void input.send().then(
      (reply) => this.applyReply(claim, reply),
      // A thrown send is the same as no reply: the request may still be running.
      () => {}
    )
    return promise
  }

  /** Fold in one snapshot of the session's own stream. */
  applyStreamSnapshot(items: readonly AgentJournalRenderItem[]): void {
    if (this.live && reachedTerminalFrame(items, this.live.terminalItemId)) {
      // The transcript carries the command's own outcome line, so the frame only has to stop the
      // wait; it does not have to restate what happened.
      this.finish(this.live, { accepted: true, error: null })
      return
    }
    if (this.unresolved && reachedTerminalFrame(items, this.unresolved.terminalItemId)) {
      this.unresolved = null
    }
  }

  /** A restart or an interrupt supersedes the obligation: nothing is owed any more. */
  reset(): void {
    if (this.live) {
      this.finish(this.live, { accepted: false, error: unconfirmedMessage() })
    }
    this.unresolved = null
  }

  private applyReply(claim: LiveClaim, reply: ConversationCommandReply): void {
    if (reply.unresolved || reply.result?.state === 'unknown') {
      // The host either never answered or answered that it cannot confirm. Either way the frame,
      // not the reply, decides.
      return
    }
    this.finish(
      claim,
      reply.result
        ? { accepted: !reply.result.error, error: reply.result.error ?? null }
        : { accepted: false, error: unconfirmedMessage() }
    )
  }

  private finish(claim: LiveClaim, outcome: ConversationCommandOutcome): void {
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
    this.unresolved = { command: claim.command, terminalItemId: claim.terminalItemId }
    claim.settle({ accepted: false, error: unresolvedMessage(claim.command) })
  }
}
