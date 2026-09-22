import type { AgentChildWorkKind, AgentChildWorkState } from './agent-status-child-work'

/** Two-state vocabulary by design: any live agent work reads as `working`; `monitoring`
 *  only when shells and monitors are the sole live work; null when nothing runs. */
export type AgentChildWorkLiveness = 'working' | 'monitoring' | null

export type AgentChildWorkLivenessCandidate = {
  kind: AgentChildWorkKind
  state?: AgentChildWorkState
}

export type AgentChildWorkLivenessEvidence = {
  hasLiveAgentWork: boolean
  hasLiveNonAgentWork: boolean
}

/** Agents and the workflows that run them; everything else is a watch loop or a shell. */
export function isAgentChildWorkKind(kind: AgentChildWorkKind): boolean {
  return kind === 'agent' || kind === 'workflow'
}

/** The settlement rule `resolveAgentChildWorkFreshness` already reads rows by: only an explicit
 *  settled state retires child work. An absent state (an old host's live task), an unknown kind
 *  and a child that lost contact all fail active, so nothing untyped or out of touch can silently
 *  retire — and a blocked subagent cannot count for less than the shell beside it. */
function isLiveChildWork(child: AgentChildWorkLivenessCandidate): boolean {
  return child.state !== 'done' && child.state !== 'idle'
}

export function agentChildWorkLivenessFromEvidence(
  evidence: AgentChildWorkLivenessEvidence
): AgentChildWorkLiveness {
  if (evidence.hasLiveAgentWork) {
    return 'working'
  }
  return evidence.hasLiveNonAgentWork ? 'monitoring' : null
}

export function agentChildWorkLiveness(
  children: readonly AgentChildWorkLivenessCandidate[] | undefined
): AgentChildWorkLiveness {
  let hasLiveAgentWork = false
  let hasLiveNonAgentWork = false
  for (const child of children ?? []) {
    if (!isLiveChildWork(child)) {
      continue
    }
    hasLiveAgentWork ||= isAgentChildWorkKind(child.kind)
    hasLiveNonAgentWork ||= !isAgentChildWorkKind(child.kind)
  }
  return agentChildWorkLivenessFromEvidence({ hasLiveAgentWork, hasLiveNonAgentWork })
}
