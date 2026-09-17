import { withTimeout } from '../../../shared/promise-timeout-fallback'
import type { AgentSessionMutationEnvelope } from '../../../shared/agent-session-wire'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { MutationPlan } from './structured-agent-session-mutation-plans'
import type { AgentSessionTurnContext, TurnOutcome } from './structured-agent-session-turns'

/** Only thrown while the provider dispatch is still unreachable. */
export class AgentSessionPreDispatchError extends Error {
  constructor(code: string) {
    super(code)
    this.name = 'AgentSessionPreDispatchError'
  }
}

export const AGENT_SESSION_ADMISSION_BARRIER_TIMEOUT_MS = 2_000

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
  let outcome: TurnOutcome<TValue> | undefined
  try {
    if (input.plan.markUnknownBeforeRun) {
      await settle({ status: 'unknown' })
    }
    if (input.plan.beforeRun) {
      // Admission predicates must include provider lifecycle already accepted by the host.
      const ready = await withTimeout(
        input.context.flushStreamedEvents().then(() => true),
        AGENT_SESSION_ADMISSION_BARRIER_TIMEOUT_MS,
        false
      )
      if (!ready) {
        throw new AgentSessionPreDispatchError('agent_session_admission_evidence_unavailable')
      }
      input.plan.beforeRun()
    }
    outcome = await input.plan.run(input.context)
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
    } catch {
      // Bookkeeping must not replace the operation's proof of whether dispatch began.
      console.warn('[structured-agent-session] operation uncertainty persistence failed')
    }
    if (outcome && !outcome.ok) {
      console.warn('[structured-agent-session] refused operation settlement failed')
      return outcome
    }
    throw error
  }
}
