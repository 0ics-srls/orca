// A send checks for a live owner before it is admitted, and restarts one if the old one is gone.
//
// A provider child that exits or fails to start hands its lease back. Before this, a send to that
// session was refused `agent_session_ownership_unknown` — which a client reads as "not admitted
// yet" and resends forever — and only a surface hold could ever make a new child. Now the send
// itself ensures its owner: a released lease where resume is allowed gets a child first; anything
// else runs as it is and meets the lease check in admission. A restart that fails for good refuses
// with a code the client stops on.
//
// The ledger outranks the lease here as it does in admission: a send the ledger already holds a
// row for restarts nothing, because admission replays or refuses it whoever owns the session now.
// Otherwise a child that dies at startup moves the fence, the client resends the same message
// against the new fence, and each replay spawns another child that dies the same way.
//
// The restart is the holds' single-flight resume, so a hold and a send arriving in the same gap
// start one child between them, and a send that joins reads the replaced fence from the resume.

import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type {
  AgentSessionMutationResult,
  AgentSessionSendResult,
  AgentSessionWireRefusal
} from '../../../shared/agent-session-wire'
import type { StructuredAgentSessionResumed } from './structured-agent-session-holds'
import { refuseAgentSessionMutation } from './structured-agent-session-mutation-admission'
import { isResumableStructuredAgentSessionRecord } from './structured-agent-session-resume-eligibility'
import {
  structuredAgentSessionSendBlock,
  type sendStructuredAgentSessionTurn
} from './structured-agent-session-host-mutations'

export const AGENT_SESSION_OWNER_UNRECOVERABLE: AgentSessionWireRefusal = {
  code: 'agent_session_owner_unrecoverable',
  message: "This chat's agent stopped and could not be restarted. Retry, or start a new chat."
}

// A resume refused this way met a lease someone else is settling — not proof it cannot resume.
const TRANSIENT_RESUME_REFUSALS: ReadonlySet<string> = new Set([
  'execution_owner_reconciling',
  'agent_session_conflict',
  'agent_session_checkpoint_stale',
  'agent_session_ownership_unknown',
  'agent_session_operation_capacity'
])

type SendParams = Parameters<typeof sendStructuredAgentSessionTurn>[2]
type SendResult = AgentSessionMutationResult<AgentSessionSendResult>

export class StructuredAgentSessionSendRecovery {
  constructor(
    private readonly deps: {
      getRecord: (sessionId: string) => AgentSessionRecord | null
      /** Whether admission can answer this session at all: it replays out of the loaded journal. */
      isAttached: (sessionId: string) => boolean
      /** Whether the ledger holds this send's row, so admission answers it without an owner. */
      hasLedgerRow: (clientOperationId: string) => boolean
      isResuming: (sessionId: string) => boolean
      /** Gives the session a provider child, or joins the resume already running for it; throws
       *  the refusal code when it cannot. */
      resume: (sessionId: string) => Promise<StructuredAgentSessionResumed>
      onError?: (input: { sessionId: string; error: unknown }) => void
    }
  ) {}

  async send(params: SendParams, run: (params: SendParams) => Promise<SendResult>) {
    const { sessionId, clientOperationId, expectedRuntimeFence } = params.envelope
    if (this.deps.isAttached(sessionId) && this.deps.hasLedgerRow(clientOperationId)) {
      return run(params)
    }
    if (!this.deps.isResuming(sessionId)) {
      const record = this.deps.getRecord(sessionId)
      // Live, unverifiable, still reserved, or handed off: that lease is not this send's to
      // replace. A send the record refuses anyway must not leave a child behind it.
      if (
        !record ||
        !isResumableStructuredAgentSessionRecord(record) ||
        structuredAgentSessionSendBlock(record)
      ) {
        return run(params)
      }
    }
    let resumed: StructuredAgentSessionResumed
    try {
      resumed = await this.deps.resume(sessionId)
    } catch (error) {
      if (error instanceof Error && TRANSIENT_RESUME_REFUSALS.has(error.message)) {
        return run(params)
      }
      this.deps.onError?.({ sessionId, error })
      return refuseAgentSessionMutation(AGENT_SESSION_OWNER_UNRECOVERABLE)
    }
    const toFence = this.deps.getRecord(sessionId)?.lease.runtimeFence
    // The client was current as of the lost owner; the new owner is the only thing that moved.
    const rebase = expectedRuntimeFence === resumed.fromFence && toFence !== undefined
    return run(
      rebase
        ? { ...params, envelope: { ...params.envelope, expectedRuntimeFence: toFence } }
        : params
    )
  }
}
