// Asking an interrupted agent to carry on — always, and only, on a deliberate user action.
//
// Reconnecting and continuing are SEPARATE operations. Reconnect reattaches and sends nothing; this
// adds one message on top of a reconnect, and only when the user pressed a control that says so.
// The automatic-reconnect setting cannot reach this module — the resume surface it calls has no
// send in it at all — so "the checkbox never continues" is structural rather than wiring
// discipline.

import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import type { AgentSessionMutationEnvelope } from '../../../shared/agent-session-wire'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import {
  AGENT_SESSION_RESTART_CONTINUATION_MESSAGE,
  AGENT_SESSION_RESTART_CONTINUATION_NOTE
} from '../../../shared/agent-session-restart-continuation'
import { structuredAgentSessionResumeOperationId } from './structured-agent-session-resume-eligibility'

export type StructuredAgentSessionContinuationOutcome = {
  sessionId: string
  outcome: 'continued' | 'refused'
  reason?: string
}

/** The message body, built once so both the send and any test read the same text. */
export function restartContinuationBody(): AgentJournalMessageItem {
  return {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: AGENT_SESSION_RESTART_CONTINUATION_MESSAGE }]
  }
}

/** The fence is read AFTER the reconnect: reattaching mints a new one, and the pre-reconnect value
 *  would be refused by the mutation admission. */
export function restartContinuationEnvelope(
  sessionId: string,
  fence: number,
  now: number
): { envelope: AgentSessionMutationEnvelope; body: AgentJournalMessageItem } {
  const body = restartContinuationBody()
  return {
    body,
    envelope: {
      sessionId,
      // The operation id IS the client message id, so one continuation is one durable row.
      clientOperationId: structuredAgentSessionResumeOperationId(now),
      expectedRuntimeFence: fence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId,
        fields: { body }
      })
    }
  }
}

export type StructuredAgentSessionContinuationDeps = {
  /** Runtime fence as it stands now; null when the session is not attached. */
  currentFence: (sessionId: string) => number | null
  send: (input: {
    envelope: AgentSessionMutationEnvelope
    body: AgentJournalMessageItem
  }) => Promise<{ ok: boolean; refusal?: { code: string } }>
  /** Records the host-authored journal note that marks this send as Orca's, not the user's. */
  note: (sessionId: string, text: string) => Promise<void>
  now: () => number
}

/**
 * Sends the continuation to ONE already-reconnected session.
 *
 * The caller must have reconnected it first: this deliberately does not reconnect, so that every
 * eligibility check, the admission gate and the consume-once ordering stay in the resume path and
 * are not re-implemented here.
 */
export async function continueStructuredAgentSessionAfterRestart(
  deps: StructuredAgentSessionContinuationDeps,
  sessionId: string
): Promise<StructuredAgentSessionContinuationOutcome> {
  const fence = deps.currentFence(sessionId)
  if (fence === null) {
    return { sessionId, outcome: 'refused', reason: 'agent_session_not_attached' }
  }
  const { envelope, body } = restartContinuationEnvelope(sessionId, fence, deps.now())
  const sent = await deps.send({ envelope, body })
  if (!sent.ok) {
    return {
      sessionId,
      outcome: 'refused',
      reason: sent.refusal?.code ?? 'agent_session_send_failed'
    }
  }
  // Best effort: the note is attribution, and losing it must never turn a delivered continuation
  // into a reported failure.
  await deps.note(sessionId, AGENT_SESSION_RESTART_CONTINUATION_NOTE).catch(() => undefined)
  return { sessionId, outcome: 'continued' }
}
