/**
 * Durable admission for `agent.launch`.
 *
 * The contract this enforces is three sentences: an operation runs at most once, a replay returns
 * the recorded answer, and an operation whose outcome is unknown is refused. Everything else a lost
 * launch might want — finding the workspace a dead attempt left behind, adopting a half-created
 * session, finishing an interrupted publication — is recovery, and none of it is here. Recovery
 * makes a stranded user whole; this makes a retry harmless, and the two are bought separately.
 *
 * The order is the inverse of what the handler did before. Admission comes first, ahead of
 * resolving the caller's worktree selector, because a selector resolution is a live precondition
 * and a replay must not be able to fail on one: an operation that already ran has an answer, and
 * re-deciding it against today's world is how a recorded success becomes a fresh refusal the client
 * then retries as a second effect. `admitAgentSessionMutation` puts the ledger ahead of the lease
 * and the fence for that same reason.
 */

import {
  computeAgentLaunchFingerprint,
  deriveAgentLaunchChildOperationId
} from '../../../../shared/agent-launch-operation'
import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import type { AgentSessionOperationOutcome } from '../../../../shared/agent-session-operation-ledger'
import type { AgentSessionWireRefusal } from '../../../../shared/agent-session-wire'
import { resolveAgentSessionReplayOutcome } from '../../../native-chat/agent-session-wire/structured-agent-session-replay-outcome'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import type { AgentSessionRecordStore } from '../../agent-session-record-store'
import type { RpcContext } from '../core'
import type { AgentLaunchParams } from './agent-launch-schemas'

/**
 * Who the ledger partitions this operation under.
 *
 * Matches `terminal.create`'s derivation so one client gets one operation namespace across the
 * lifecycle methods. Stated honestly: only the paired device id is an identity a caller keeps
 * across reconnects. `clientId` is the documented fallback, and on the websocket dispatch path it
 * is the bearer token itself — which rotates, so a caller that re-authenticates lands in a fresh
 * partition where its earlier ids are unreachable rather than replayable. That is the safe
 * direction (an unreachable row never replays as done), but it is a real limit, not the absence of
 * one. `local` covers the in-process caller, which is the same build as the host.
 */
export function agentLaunchOperationCallerKey(
  context: Pick<RpcContext, 'pairedDeviceId' | 'clientId'>
): string {
  return context.pairedDeviceId ?? context.clientId ?? 'local'
}

/**
 * The store is owned by the structured session host, so reaching it installs that host — already
 * true of any structured launch, which installs it to attach. The change is that a terminal-bound
 * launch now opens the record store too, when and only when its caller asked for replay safety.
 */
async function requireLaunchOperationStore(context: RpcContext): Promise<AgentSessionRecordStore> {
  await context.runtime.ensureStructuredAgentSessionHost()
  const host = getStructuredAgentSessionHost()
  if (!host) {
    throw new Error('structured_agent_session_unsupported')
  }
  return host.deps.store
}

export type AgentLaunchAdmission =
  /** This caller owns the operation. It alone runs the effect, and it must settle the row. */
  | {
      decision: 'execute'
      settle: (result: AgentLaunchResult) => Promise<void>
      fail: (code: string) => Promise<void>
      /** Distinct from the launch id: the inner attach reserves in this same ledger. */
      attachOperationId: string
    }
  /** Already run under this id; hand back what it produced rather than producing it again. */
  | { decision: 'replay'; result: AgentLaunchResult }
  | { decision: 'refuse'; refusal: AgentSessionWireRefusal }

/** A recorded row read back as an answer. `pending` is the one state with no answer yet — nobody
 *  has claimed it — so it reports `rerun`, and the caller goes on to try the claim. */
function answerFromRecordedRow(
  operationId: string,
  outcome: AgentSessionOperationOutcome
): AgentLaunchAdmission | null {
  const replay = resolveAgentSessionReplayOutcome<AgentLaunchResult>({
    operationId,
    outcome,
    reconstruct: () => (outcome.status === 'succeeded' ? (outcome.launch ?? null) : null)
  })
  if (replay.decision === 'rerun') {
    return null
  }
  return replay.decision === 'replay'
    ? { decision: 'replay', result: replay.value }
    : { decision: 'refuse', refusal: replay.refusal }
}

/**
 * Admit, then claim.
 *
 * Two steps because they answer different questions — "is this id known and consistent?" and "may
 * *I* run it?" — and the second cannot be folded into the first. Admission hands two concurrent
 * replays the same `pending` row; only a conditional swap can tell the one that may run from the
 * one that must replay.
 */
export async function admitAgentLaunchOperation(
  context: RpcContext,
  params: AgentLaunchParams & { operationId: string },
  now: number = Date.now()
): Promise<AgentLaunchAdmission> {
  const operationId = params.operationId
  const attachOperationId = deriveAgentLaunchChildOperationId(operationId)
  if (!attachOperationId) {
    return refusal(operationId, 'agent_session_operation_invalid', 'is not a durable operation id')
  }
  const store = await requireLaunchOperationStore(context)
  const callerKey = agentLaunchOperationCallerKey(context)
  const admitted = await store.admitOperation({
    callerKey,
    operationId,
    // Host-computed over the caller's stated intent; a digest the caller supplied is a digest a
    // buggy caller can make agree with anything.
    fingerprint: computeAgentLaunchFingerprint(params),
    now
  })
  if (admitted.decision === 'refused') {
    return refusal(operationId, admitted.code, `was refused: ${admitted.code}`)
  }
  if (admitted.decision === 'replay') {
    const answer = answerFromRecordedRow(operationId, admitted.row.outcome)
    if (answer) {
      return answer
    }
  }
  const claim = await store.claimOperation({ callerKey, operationId })
  if (claim.claim === 'lost') {
    // Never `pending` — a pending row is exactly what a claim takes — so this always has an answer.
    return (
      answerFromRecordedRow(operationId, claim.row.outcome) ??
      refusal(operationId, 'agent_session_operation_unknown', 'is claimed but unsettled')
    )
  }
  if (claim.claim === 'absent') {
    // Admitted a moment ago and gone already: the row cannot be re-admitted without reopening the
    // duplicate-spawn window it exists to close, so this stays uncertain.
    return refusal(
      operationId,
      'agent_session_operation_unknown',
      'was pruned between admission and its claim; its outcome is unknown'
    )
  }
  return {
    decision: 'execute',
    attachOperationId,
    settle: (result) =>
      store.recordOperationOutcome({
        callerKey,
        operationId,
        outcome: {
          status: 'succeeded',
          // A terminal surface has a handle, not a session id; `launch` carries whichever it is.
          sessionId: result.outcome.kind === 'structured' ? result.outcome.sessionId : '',
          launch: result
        }
      }),
    fail: (code) =>
      store.recordOperationOutcome({
        callerKey,
        operationId,
        outcome: { status: 'failed', code }
      })
  }
}

function refusal(
  operationId: string,
  code: AgentSessionWireRefusal['code'],
  detail: string
): AgentLaunchAdmission {
  return {
    decision: 'refuse',
    refusal: { code, message: `Launch operation ${operationId} ${detail}.` }
  }
}
