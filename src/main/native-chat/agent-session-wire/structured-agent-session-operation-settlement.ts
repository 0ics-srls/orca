import type { AgentSessionMutationEnvelope } from '../../../shared/agent-session-wire'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { MutationPlan } from './structured-agent-session-mutation-plans'
import type { AgentSessionTurnContext, TurnOutcome } from './structured-agent-session-turns'

export async function runSettledAgentSessionMutation<TValue>(input: {
  store: AgentSessionRecordStore
  operationCallerKey: string
  envelope: AgentSessionMutationEnvelope
  plan: MutationPlan<TValue>
  context: AgentSessionTurnContext
}): Promise<TurnOutcome<TValue>> {
  const settle = (
    outcome: Parameters<AgentSessionRecordStore['recordOperationOutcome']>[0]['outcome']
  ) =>
    input.store.recordOperationOutcome({
      callerKey: input.operationCallerKey,
      operationId: input.envelope.clientOperationId,
      outcome
    })
  try {
    if (input.plan.markUnknownBeforeRun) {
      await settle({ status: 'unknown' })
    }
    if (input.plan.beforeRun) {
      // Admission predicates must include provider lifecycle already accepted by the host.
      await input.context.flushStreamedEvents()
      input.plan.beforeRun()
    }
    const outcome = await input.plan.run(input.context)
    await settle(
      outcome.ok
        ? (input.plan.settledOutcome?.(outcome.value) ?? {
            status: 'succeeded',
            sessionId: input.envelope.sessionId
          })
        : {
            status: 'failed',
            code: outcome.refusal.code,
            ...(outcome.refusal.rewindReason ? { rewindReason: outcome.refusal.rewindReason } : {})
          }
    )
    return outcome
  } catch (error) {
    try {
      await settle({ status: 'unknown' })
    } catch (settlementError) {
      // Bookkeeping must not replace the operation's proof of whether dispatch began.
      console.warn(
        '[structured-agent-session] operation uncertainty persistence failed',
        settlementError
      )
    }
    throw error
  }
}
