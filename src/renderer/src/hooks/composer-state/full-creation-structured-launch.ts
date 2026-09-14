import type { AgentSessionLaunchPlan } from '@/lib/agent-session-launch-plan'
import type { StructuredAgentLaunchSettlement } from '@/lib/structured-agent-launch-settlement'
import { activateStructuredAgentSessionById } from '@/lib/structured-agent-session-tab-activation'

/** Full-create dialog: the structured launch plus what this flow did before structured chat
 *  existed. Returns null when the plan's route is not structured. */
export async function settleFullCreationStructuredLaunch(args: {
  /** Planned before the worktree existed; `worktreeId` names the one that was created. */
  plan: AgentSessionLaunchPlan
  worktreeId: string
}): Promise<StructuredAgentLaunchSettlement | null> {
  return args.plan.launch(
    {
      onStructuredReady: (sessionId) =>
        activateStructuredAgentSessionById({ worktreeId: args.worktreeId, sessionId })
    },
    { worktreeId: args.worktreeId }
  )
}
