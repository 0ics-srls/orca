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
import type { AgentJournalTurnLifecycle } from '../../../shared/agent-session-journal-types'
import { agentSessionProviderHandleChainHead } from '../../../shared/agent-session-provider-handle'
import { agentSessionProviderHandleRoot } from '../../../shared/agent-session-provider-handle'
import {
  isExpiredAgentSessionResumeMarker,
  type AgentSessionResumeMarker,
  type AgentSessionResumeTrigger
} from '../../../shared/agent-session-resume-marker'
import { isResumableStructuredAgentSessionRecord } from './structured-agent-session-resume-eligibility'

export type StructuredAgentSessionResumeCandidate = {
  sessionId: string
  workspaceId: string
  agent: AgentSessionRecord['provider']
  turnId: string
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
    const turn = input.journalTurn(marker.sessionId)
    if (!turn || turn.turnId !== marker.turnId) {
      continue
    }
    // State, not just identity. Eviction rewrites `running` -> `interrupted` and never ->
    // `completed`, so a completed turn is finished work and a turn still marked `running` was never
    // settled by anyone. Offering either is the exact failure this feature exists to prevent.
    if (turn.state !== 'interrupted' && turn.state !== 'unverifiable') {
      continue
    }
    // Read off the MARKER, never re-derived. Teardown cancels the pending prompt a few phases after
    // it writes the marker, so by now the live journal no longer reports `attention` for exactly the
    // sessions this refuses — which is what made the re-derived version inert.
    if (marker.awaitsUser) {
      continue
    }
    candidates.push({
      sessionId: marker.sessionId,
      workspaceId: record.location.workspaceId,
      agent: record.provider,
      turnId: marker.turnId,
      trigger: marker.trigger,
      recordedAt: marker.recordedAt,
      latestPrompt: input.latestPrompt(marker.sessionId)
    })
  }
  return candidates
}
