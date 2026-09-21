import { INTERRUPTED_TURN_LATE_PROGRESS_MS, TOOL_PROGRESS_HOOK_EVENTS } from './server-constants'
import type { EnrichedAgentHookEventPayload } from './server-types'
import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'

/**
 * True when `next` is late progress from the turn `previous` already reported stopped, rather than
 * a fresh turn. There is no turn id on this wire, so identity is the pane's prompt and agent plus
 * a short window; a new prompt, a different agent, or a long gap all read as a new turn.
 */
function reportsTheStoppedTurn(
  previous: EnrichedAgentHookEventPayload,
  next: AgentHookEventPayload,
  now: number
): boolean {
  if (
    previous.payload.agentType !== next.payload.agentType ||
    previous.payload.prompt !== next.payload.prompt
  ) {
    return false
  }
  if (next.isReplay === true) {
    return true
  }
  // Why: a same-prompt retry arrives as another UserPromptSubmit, while late post-Ctrl+C progress
  // arrives as tool lifecycle work — which Claude and Codex label and other agents do not.
  if (
    (next.payload.agentType === 'claude' || next.payload.agentType === 'codex') &&
    next.hookEventName !== undefined &&
    TOOL_PROGRESS_HOOK_EVENTS.has(next.hookEventName)
  ) {
    return true
  }
  return (
    next.hasExplicitPrompt !== true &&
    now - previous.receivedAt <= INTERRUPTED_TURN_LATE_PROGRESS_MS
  )
}

/**
 * The user stopping a turn is a fact about the turn, not a claim that the pane finished, so a hook
 * still in flight from that turn is published as the work it reports and inherits the fact — a late
 * tool step lands as `working` carrying the interrupt, and the turn's own terminal report lands as
 * `done` carrying it.
 *
 * This replaced freezing the row on the stopped `done` for the same cases. Freezing hid a tool the
 * agent was genuinely still running and pinned a stale timestamp, and it was only ever needed
 * because `interrupted` could not ride any row but a `done` one. Returns `next` unchanged when
 * nothing is inherited.
 */
export function inheritInterruptedTurnFact(
  previous: EnrichedAgentHookEventPayload | undefined,
  next: AgentHookEventPayload,
  now: number
): AgentHookEventPayload {
  if (
    previous?.payload.interrupted !== true ||
    next.payload.interrupted === true ||
    !reportsTheStoppedTurn(previous, next, now)
  ) {
    return next
  }
  return { ...next, payload: { ...next.payload, interrupted: true } }
}
