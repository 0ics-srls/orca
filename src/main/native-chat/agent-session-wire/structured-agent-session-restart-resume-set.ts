// Which of the previous generation's markers a launch may actually act on.
//
// Every clause here exists to refuse, and the bias is deliberate: a session resumed that should not
// have been spends the user's tokens and can make an agent redo destructive work it already
// finished. A session missed is an annoyance. When any input is ambiguous this answers "no".
//
// Two INDEPENDENT records must concur. The marker is teardown's word; the journal's own turn record
// is the session's word. One without the other proves nothing — a marker whose journal never opened
// that turn is a marker for work that did not exist, and a journal turn with no marker is the
// stale-`running`-row case this whole mechanism exists to refuse.

import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type {
  AgentJournalSubmission,
  AgentJournalTurnLifecycle
} from '../../../shared/agent-session-journal-types'
import { agentSessionProviderHandleChainHead } from '../../../shared/agent-session-provider-handle'
import { agentSessionProviderHandleRoot } from '../../../shared/agent-session-provider-handle'
import {
  isExpiredAgentSessionResumeMarker,
  type AgentSessionResumeMarker,
  type AgentSessionResumeTrigger,
  type AgentSessionResumeWork
} from '../../../shared/agent-session-resume-marker'
import { isResumableStructuredAgentSessionRecord } from './structured-agent-session-resume-eligibility'

export type StructuredAgentSessionResumeCandidate = {
  sessionId: string
  workspaceId: string
  agent: AgentSessionRecord['provider']
  work: AgentSessionResumeWork
  trigger: AgentSessionResumeTrigger
  recordedAt: number
  /** The prompt the row quotes, so the user recognises the chat before resuming it. */
  latestPrompt: string
}

export type StructuredAgentSessionResumeSetInput = {
  markers: readonly AgentSessionResumeMarker[]
  getRecord: (sessionId: string) => AgentSessionRecord | null
  supportsRecord: (record: AgentSessionRecord) => boolean
  /** The newest turn record in that session's journal, state included; null when the journal could
   *  not be read. Deliberately not the live-turn reader: eviction has already rewritten that turn
   *  to `interrupted` by the time this runs. */
  journalTurn: (sessionId: string) => AgentJournalTurnLifecycle | null
  /** The journalled submission with that client message id, for work that never became a turn. */
  journalSubmission: (sessionId: string, clientMessageId: string) => AgentJournalSubmission | null
  latestPrompt: (sessionId: string) => string
  now: number
  /**
   * Whether the lease must be free.
   *
   * `may-be-held` is used for ONE thing: deciding whether a session whose own pane already
   * re-acquired it may be settled as resumed. Every other clause still applies — relaxing this one
   * must never become a way to act on a marker the rest of the predicate rejected.
   */
  leaseState?: 'must-be-released' | 'may-be-held'
}

/**
 * The journal's own answer about the marked work, which must agree it was CUT OFF rather than
 * finished. This is the second of the two independent records.
 *
 * A TURN: eviction rewrites `running` -> `interrupted` and never -> `completed`, so a completed
 * turn is finished work and one still marked `running` was never settled by anyone.
 *
 * A SUBMISSION never became a turn, so its dispatch state carries the same evidence — settled to
 * `unknown` by the close path, or still `pending` because nothing settled it. An `accepted` or
 * `rejected` submission is not interrupted work: the first became a turn, the second never ran.
 */
function journalAgreesWorkWasCutOff(
  input: StructuredAgentSessionResumeSetInput,
  marker: AgentSessionResumeMarker
): boolean {
  if (marker.work.kind === 'turn') {
    const turn = input.journalTurn(marker.sessionId)
    return (
      turn?.turnId === marker.work.id &&
      (turn.state === 'interrupted' || turn.state === 'unverifiable')
    )
  }
  const submission = input.journalSubmission(marker.sessionId, marker.work.id)
  return (
    submission?.clientMessageId === marker.work.id &&
    (submission.dispatchState === 'unknown' || submission.dispatchState === 'pending')
  )
}

export function structuredAgentSessionResumableSet(
  input: StructuredAgentSessionResumeSetInput
): StructuredAgentSessionResumeCandidate[] {
  const candidates: StructuredAgentSessionResumeCandidate[] = []
  for (const marker of input.markers) {
    if (isExpiredAgentSessionResumeMarker(marker, input.now)) {
      continue
    }
    const record = input.getRecord(marker.sessionId)
    if (!record || !input.supportsRecord(record)) {
      continue
    }
    // The lease must be free and adjudicated. A contested or still-reconciling record is somebody
    // else's to resolve, and resuming into it is how a session gets two writers.
    if (input.leaseState !== 'may-be-held' && !isResumableStructuredAgentSessionRecord(record)) {
      continue
    }
    // A conversation that FORKED since teardown is not the one we marked. Compared by identity
    // root, because a resume legitimately advances Claude's leaf and that is not a fork.
    const head = agentSessionProviderHandleChainHead(record.providerHandleChain)
    if (!head || agentSessionProviderHandleRoot(head.handle) !== marker.providerHandleRoot) {
      continue
    }
    if (!journalAgreesWorkWasCutOff(input, marker)) {
      continue
    }
    candidates.push({
      sessionId: marker.sessionId,
      workspaceId: record.location.workspaceId,
      agent: record.provider,
      work: marker.work,
      trigger: marker.trigger,
      recordedAt: marker.recordedAt,
      latestPrompt: input.latestPrompt(marker.sessionId)
    })
  }
  return candidates
}
