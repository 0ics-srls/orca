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
import { normalizeOptionalField } from '../../../shared/agent-status-field-normalization'
import { AGENT_MODEL_MAX_LENGTH } from '../../../shared/agent-status-types'

export type StructuredAgentSessionResumeCandidate = {
  sessionId: string
  workspaceId: string
  agent: AgentSessionRecord['provider']
  work: AgentSessionResumeWork
  trigger: AgentSessionResumeTrigger
  recordedAt: number
  /** The prompt the row quotes, so the user recognises the chat before resuming it. */
  latestPrompt: string
  /** Which machine ran it, so the offer carries the same host badge the sidebar shows. */
  executionHostId: AgentSessionRecord['location']['executionHostId']
  /** Git worktree or folder workspace — the surface picks its glyph from this, never from a name. */
  workspaceKind: AgentSessionRecord['location']['workspaceKind']
  /** Model in force, read from the record's acknowledged options exactly as the status feed does.
   *  Absent until the host has read them. */
  model?: string
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

/** Eviction rewrites `running` -> `interrupted` and never -> `completed`, so a completed turn is
 *  finished work and one still marked `running` was never settled by anyone. */
function turnWasCutOff(turn: AgentJournalTurnLifecycle | null): boolean {
  return turn !== null && (turn.state === 'interrupted' || turn.state === 'unverifiable')
}

/**
 * The turn an accepted submission opened, or null when the journal cannot prove the link.
 *
 * A turn names the user item that opened it, and a submission the provider acknowledged is reached
 * through that key — the same alias the turn-timing selector resolves. Without both halves there is
 * no proof this turn is the marked work rather than an older one, so this refuses.
 */
function turnTheSubmissionOpened(
  input: StructuredAgentSessionResumeSetInput,
  sessionId: string,
  submission: AgentJournalSubmission
): AgentJournalTurnLifecycle | null {
  const turn = input.journalTurn(sessionId)
  if (!turn || turn.userItemId === undefined || submission.providerItemId === null) {
    return null
  }
  return turn.userItemId === submission.providerItemId ? turn : null
}

/**
 * The journal's own answer about the marked work, which must agree it was CUT OFF rather than
 * finished. This is the second of the two independent records.
 *
 * A TURN is judged directly. A SUBMISSION is FOLLOWED FORWARD, because the window in which work is
 * submission-shaped is precisely the window in which its dispatch is about to settle — the marker
 * is written mid-flight and the dispatch can reach `accepted` before the process dies. Freezing
 * judgement at the marker's shape would refuse exactly the sessions this exists to catch.
 *
 *   pending / unknown -> never became a turn, and nothing settled it: cut off.
 *   rejected          -> never ran at all.
 *   accepted          -> it BECAME a turn, so the turn is the evidence, judged by the turn rule.
 *                        Accepted alone proves only that the provider took the message; it is the
 *                        turn's own state that says whether the work was interrupted or finished.
 */
function journalAgreesWorkWasCutOff(
  input: StructuredAgentSessionResumeSetInput,
  marker: AgentSessionResumeMarker
): boolean {
  if (marker.work.kind === 'turn') {
    const turn = input.journalTurn(marker.sessionId)
    return turn?.turnId === marker.work.id && turnWasCutOff(turn)
  }
  const submission = input.journalSubmission(marker.sessionId, marker.work.id)
  if (submission?.clientMessageId !== marker.work.id) {
    return false
  }
  if (submission.dispatchState === 'unknown' || submission.dispatchState === 'pending') {
    return true
  }
  if (submission.dispatchState !== 'accepted') {
    return false
  }
  return turnWasCutOff(turnTheSubmissionOpened(input, marker.sessionId, submission))
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
    const model = normalizeOptionalField(record.options?.model, AGENT_MODEL_MAX_LENGTH)
    candidates.push({
      sessionId: marker.sessionId,
      workspaceId: record.location.workspaceId,
      agent: record.provider,
      work: marker.work,
      trigger: marker.trigger,
      recordedAt: marker.recordedAt,
      latestPrompt: input.latestPrompt(marker.sessionId),
      executionHostId: record.location.executionHostId,
      workspaceKind: record.location.workspaceKind,
      ...(model === undefined ? {} : { model })
    })
  }
  return candidates
}
