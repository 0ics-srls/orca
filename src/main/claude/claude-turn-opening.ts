// Which provider frame opens a Claude turn.
//
// Orca's own send echo used to be the only opener, while any `result` frame
// closed the turn. That asymmetry is what leaves a working session reading
// idle: the provider resumes on its own — a background task reports in and
// wakes the agent after a `result` settled the turn — and nothing Orca sent
// ever arrives to reopen one. The model's own output is the evidence that a
// turn is running, the way Codex's `turn/start` is, so it opens one here.
// Whichever opened it, the next `result` settles it.

import {
  claudeHasReplayContent,
  type ClaudeMessageEnvelope
} from './claude-structured-item-translation'
import type { ClaudeCurrentTurn } from './claude-turn-lifecycle-item'

export type ClaudeTurnOpeningInput = {
  envelope: ClaudeMessageEnvelope
  /** The raw frame: the turn boundary reads `parent_tool_use_id` off it, and an
   *  absent field is not the same claim as an explicit `null`. */
  frame: Record<string, unknown>
  /** Orca dispatched this send and the provider is replaying it back. */
  startsTurn: boolean
  /** The frame appended journal content, so the provider produced just now. */
  producedContent: boolean
  hasOpenTurn: boolean
  observedAt: number
  /** Provider key of the user row, used only by the send echo. */
  userItemId: string
}

export function claudeTurnOpenedByFrame(input: ClaudeTurnOpeningInput): ClaudeCurrentTurn | null {
  // A subagent's frames are its parent turn's work, never a turn of their own.
  if (input.frame.parent_tool_use_id !== null) {
    return null
  }
  const { envelope, observedAt } = input
  const turn = { sessionId: envelope.sessionId, turnId: envelope.uuid, startedAt: observedAt }
  if (envelope.role === 'user') {
    return input.startsTurn && claudeHasReplayContent(envelope)
      ? { ...turn, userItemId: input.userItemId }
      : null
  }
  // Resumed work has no user row to anchor to. Reopening only when no turn is
  // open keeps every frame of one reply inside the turn its first frame opened,
  // and keeps this off the path of a turn Orca is already tracking.
  return !input.hasOpenTurn && input.producedContent ? turn : null
}
