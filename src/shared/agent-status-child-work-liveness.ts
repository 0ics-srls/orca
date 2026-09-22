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

function isLiveAgentWork(child: AgentChildWorkLivenessCandidate): boolean {
  if (!isAgentChildWorkKind(child.kind)) {
    return false
  }
  // Absent state is an old host's live task; live means working here.
  return child.state === undefined || child.state === 'working' || child.state === 'monitoring'
}

function isLiveNonAgentWork(child: AgentChildWorkLivenessCandidate): boolean {
  if (isAgentChildWorkKind(child.kind)) {
    return false
  }
  // Why: only an explicit settled state retires a shell or monitor; an unknown kind or an
  // unverifiable state fails active, so untyped work can never silently retire.
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
    hasLiveAgentWork ||= isLiveAgentWork(child)
    hasLiveNonAgentWork ||= isLiveNonAgentWork(child)
  }
  return agentChildWorkLivenessFromEvidence({ hasLiveAgentWork, hasLiveNonAgentWork })
}
