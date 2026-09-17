import type { AgentHookSource } from '../../shared/agent-hook-relay'
import type {
  AgentStatusExecutionBinding,
  AgentStatusReportedExecutionBinding
} from '../../shared/agent-status-execution-binding'
import type { ClaimedAgentPtyOwnerRegistry } from '../../shared/claimed-agent-pty-owner'
import { makePaneKey } from '../../shared/stable-pane-id'
import { worktreeIdsEqual } from '../../shared/worktree/id'

export type AgentStatusExecutionBindingCandidate = {
  paneKey: string
  worktreeId?: string
  source?: AgentHookSource
  reported: AgentStatusReportedExecutionBinding
}

export type AgentStatusExecutionBindingResolver = (
  candidate: AgentStatusExecutionBindingCandidate
) => AgentStatusExecutionBinding | null

/** Resolve only an exact emitter claim on the committed owner for this concrete surface. */
export function createAgentStatusExecutionBindingResolver(
  owners: ClaimedAgentPtyOwnerRegistry
): AgentStatusExecutionBindingResolver {
  return (candidate) => {
    const matches = owners.list().filter((owner) => {
      const binding = owner.statusBinding
      return (
        owner.phase === 'live' &&
        makePaneKey(owner.surface.tabId, owner.surface.leafId) === candidate.paneKey &&
        (!candidate.worktreeId ||
          worktreeIdsEqual(owner.surface.worktreeId, candidate.worktreeId)) &&
        (!candidate.source || owner.claim.agent === candidate.source) &&
        binding.runId === candidate.reported.runId &&
        binding.attachment.executionId === candidate.reported.executionId
      )
    })
    return matches.length === 1 ? matches[0].statusBinding : null
  }
}
