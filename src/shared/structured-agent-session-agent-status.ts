import type { AgentSessionStatusSummary } from './agent-session-wire'
import { foldAgentLeadStatus } from './agent-lead-status-fold'
import { agentChildWorkLiveness } from './agent-status-child-work-liveness'
import type { AgentStatusState, AgentWorkingMode } from './agent-status-types'
import type { StructuredAgentSessionProjectedStatus } from './structured-agent-session-projection'

export type StructuredAgentSessionAgentStatus = {
  state: AgentStatusState
  workingMode?: AgentWorkingMode
}

/** The lead state one projected session status stands for, before child work is folded in. */
function structuredAgentSessionLeadState(
  status: StructuredAgentSessionProjectedStatus
): 'working' | 'blocked' | 'done' {
  return status === 'working' ? 'working' : status === 'attention' ? 'blocked' : 'done'
}

/** The agent-status state one structured session summary stands for, with its live child
 *  work folded in the same way the hook lane folds a subagent roster. Shared across the
 *  process boundary so `worktree ps`, mobile and the sidebar cannot disagree about one session. */
export function structuredAgentSessionAgentStatus(
  summary: Pick<AgentSessionStatusSummary, 'backgroundTasks'> & {
    status: StructuredAgentSessionProjectedStatus
  }
): StructuredAgentSessionAgentStatus {
  const resolution = foldAgentLeadStatus({
    leadState: structuredAgentSessionLeadState(summary.status),
    // The task list is the provider's live roster, so a settled task leaves it on its own;
    // there is no hook-time inventory snapshot for an interrupt to distrust.
    interrupted: false,
    childWorkLiveness: agentChildWorkLiveness(summary.backgroundTasks)
  })
  return {
    state: resolution.stateName,
    ...(resolution.workingMode ? { workingMode: resolution.workingMode } : {})
  }
}
