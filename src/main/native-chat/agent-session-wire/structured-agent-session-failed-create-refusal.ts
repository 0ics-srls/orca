import type { AgentSessionWireRefusal } from '../../../shared/agent-session-wire'
import type { AgentSessionOperationOutcome } from '../../../shared/agent-session-operation-ledger'
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
