import type {
  AgentSessionAttachResult,
  AgentSessionMutationResult,
  AgentSessionWireRefusal
} from '../../../shared/agent-session-wire'
import type {
  AgentSessionOperationOutcome,
  AgentSessionOperationRow
} from '../../../shared/agent-session-operation-ledger'
import { agentSessionLeaseOwnerVerdict } from '../../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'

/** Only a durably failed operation says anything about retrying under a new one. */
export function failedCreateRefusal(
  refusal: AgentSessionWireRefusal,
  status: AgentSessionOperationOutcome['status'],
  record: AgentSessionRecord | null
): { ok: false; refusal: AgentSessionWireRefusal } {
  return status === 'failed' && record
    ? {
        ok: false,
        refusal: { ...refusal, ownerVerdict: agentSessionLeaseOwnerVerdict(record.lease) }
      }
    : { ok: false, refusal }
}

/** The one place a create refusal learns its verdict: from the durable row this operation
 *  settled to, so every refusal shape answers the same fact and no site can forget the stamp. */
export function stampFailedCreateOwnerVerdict(
  store: {
    getOperationRow: (callerKey: string, operationId: string) => AgentSessionOperationRow | null
    getRecord: (sessionId: string) => AgentSessionRecord | null
  },
  callerKey: string,
  envelope: { sessionId: string; clientOperationId: string },
  result: AgentSessionMutationResult<AgentSessionAttachResult>
): AgentSessionMutationResult<AgentSessionAttachResult> {
  if (result.ok) {
    return result
  }
  const row = store.getOperationRow(callerKey, envelope.clientOperationId)
  return failedCreateRefusal(
    result.refusal,
    row?.outcome.status ?? 'pending',
    store.getRecord(envelope.sessionId)
  )
}
