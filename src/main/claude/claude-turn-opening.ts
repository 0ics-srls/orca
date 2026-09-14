// Whether Orca's own send echo opens a turn.
//
// The provider's own output opens one too — see `ensureTurnOpen` in the
// translator, which the content sites call as they journal. Orca's turn used to
// open only here, while any `result` frame closed it, and that asymmetry is what
// leaves a working session reading idle: the provider resumes on its own when a
// background task reports in and wakes the agent, and nothing Orca sent ever
// arrives to reopen a turn.

import {
  claudeHasReplayContent,
  type ClaudeMessageEnvelope
} from './claude-structured-item-translation'
import type { ClaudeCurrentTurn } from './claude-turn-lifecycle-item'

export type ClaudeSendEchoTurnInput = {
  envelope: ClaudeMessageEnvelope
  /** The raw frame: an absent `parent_tool_use_id` is not the same claim as an
   *  explicit `null`, and only a root frame carries a root turn. */
  frame: Record<string, unknown>
  /** Orca dispatched this send and the provider is replaying it back. */
  startsTurn: boolean
  observedAt: number
  /** Provider key of the user row this turn is anchored to. */
  userItemId: string
}

/** The turn a replayed send echo opens, or null when this frame is not one. */
export function claudeTurnOpenedBySendEcho(
  input: ClaudeSendEchoTurnInput
): ClaudeCurrentTurn | null {
  const { envelope } = input
  return envelope.role === 'user' &&
    input.startsTurn &&
    claudeHasReplayContent(envelope) &&
    input.frame.parent_tool_use_id === null
    ? {
        sessionId: envelope.sessionId,
        turnId: envelope.uuid,
        startedAt: input.observedAt,
        userItemId: input.userItemId
      }
    : null
}
