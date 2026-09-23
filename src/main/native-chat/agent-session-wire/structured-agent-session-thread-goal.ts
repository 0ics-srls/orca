// `agentSession.threadGoal`: change the provider thread's goal through the same
// admission, ledger and journal path every other session mutation takes.

import type { AgentJournalItemIdentity } from '../../../shared/agent-session-journal-types'
import type {
  AgentSessionMutationEnvelope,
  AgentSessionThreadGoalChange,
  AgentSessionThreadGoalResult
} from '../../../shared/agent-session-wire'
import type { MutationPlan } from './structured-agent-session-mutation-plans'
import type { AgentSessionTurnContext, TurnOutcome } from './structured-agent-session-turns'

function refused(message: string): TurnOutcome<AgentSessionThreadGoalResult> {
  return { ok: false, refusal: { code: 'agent_session_operation_invalid', message } }
}

/** Keyed by the operation, so a replayed set upserts its one objective row. */
function objectiveIdentity(clientOperationId: string): AgentJournalItemIdentity {
  return { provider: 'orca', clientMessageId: `thread-goal:${clientOperationId}` }
}

export async function performThreadGoalChange(
  ctx: AgentSessionTurnContext,
  input: { clientOperationId: string; change: AgentSessionThreadGoalChange }
): Promise<TurnOutcome<AgentSessionThreadGoalResult>> {
  if (!ctx.adapter.changeThreadGoal || !ctx.adapter.supportsThreadGoal?.(ctx.sessionId)) {
    return refused('Goals are unavailable for this chat session.')
  }
  const { change } = input
  const identity = objectiveIdentity(input.clientOperationId)
  // Journal first: an active goal starts provider work at once, and the objective
  // must land ahead of that work in the transcript.
  if (change.kind === 'set') {
    await ctx.journal.appendItem(
      identity,
      {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'text', text: change.objective }],
        sentAs: 'goal'
      },
      { fence: ctx.fence }
    )
    ctx.publish()
  }
  const withdrawObjective = async (): Promise<void> => {
    if (change.kind === 'set') {
      // Nothing was sent as a goal.
      await ctx.journal.appendTombstone(identity, { fence: ctx.fence })
      ctx.publish()
    }
  }
  let result: Awaited<ReturnType<typeof ctx.adapter.changeThreadGoal>>
  try {
    result = await ctx.adapter.changeThreadGoal({
      sessionId: ctx.sessionId,
      fence: ctx.fence,
      change
    })
  } catch (error) {
    await withdrawObjective()
    throw error
  }
  if (!result.ok) {
    await withdrawObjective()
    return refused(result.rejected)
  }
  return { ok: true, value: { change: change.kind } }
}

export function threadGoalPlan(params: {
  envelope: AgentSessionMutationEnvelope
  change: AgentSessionThreadGoalChange
}): MutationPlan<AgentSessionThreadGoalResult> {
  return {
    method: 'agentSession.threadGoal',
    fields: { change: params.change },
    run: (ctx) =>
      performThreadGoalChange(ctx, {
        clientOperationId: params.envelope.clientOperationId,
        change: params.change
      }),
    // Setting an active goal starts provider work, so only a settled success is answered
    // without running again.
    replay: (_ctx, outcome) =>
      outcome.status === 'succeeded' ? { change: params.change.kind } : null
  }
}
