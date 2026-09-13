/** Derivation of a completion's identity from a hook payload: the stable key that decides
 *  whether a `done` has already been announced. Pure — no coordinator state, which is why it
 *  lives outside the controller closure. */
import type { AgentCompletionStatusSnapshot } from './agent-completion-coordinator-types'

export function isFiniteTurnCompletedAt(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function completionIdentityFor(
  state: string,
  agentType: string | undefined,
  timestamp: number
): string {
  return [state, agentType ?? '', String(Math.trunc(timestamp))].join(':')
}

export function hookCompletionIdentity(payload: AgentCompletionStatusSnapshot): string | null {
  // Why: `stateStartedAt` is pinned while the reported state does not change. A Claude pane held at `working` by background inventory would otherwise give every turn in the run the same identity.
  const timestamp = isFiniteTurnCompletedAt(payload.turnCompletedAt)
    ? payload.turnCompletedAt
    : payload.stateStartedAt
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return null
  }
  return completionIdentityFor(payload.state, payload.agentType, timestamp)
}

export function hookCompletionAgentIdentity(payload: AgentCompletionStatusSnapshot): string | null {
  return payload.agentType?.trim().toLowerCase() || null
}
