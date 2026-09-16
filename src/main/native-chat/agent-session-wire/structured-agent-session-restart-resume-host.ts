// The host's restart-resume surface: what teardown records, what may resume, and the one call that
// resumes it.
//
// Assembled here rather than on the host for the same reason holds and handoffs were — the host is
// a coordinator, and a marker set that has to open journals before it can adjudicate them reads
// better next to the predicate it feeds.

import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { AgentSessionResumeTrigger } from '../../../shared/agent-session-resume-marker'
import {
  latestStructuredAgentSessionPrompt,
  newestStructuredAgentSessionTurn
} from '../../../shared/structured-agent-session-projection'
import type { AgentSessionResumeMarker } from '../../../shared/agent-session-resume-marker'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { adapterSupportsRecord } from './structured-agent-session-provider-support'
import {
  structuredAgentSessionResumableSet,
  type StructuredAgentSessionResumeCandidate
} from './structured-agent-session-restart-resume-set'
import {
  resumeStructuredAgentSessionsFromRestart,
  StructuredAgentSessionResumeAdmission,
  type StructuredAgentSessionResumeOutcome
} from './structured-agent-session-restart-resume-runner'
import { structuredAgentSessionsWorkingAtTeardown } from './structured-agent-session-working-at-teardown'
import {
  continueStructuredAgentSessionAfterRestart,
  type StructuredAgentSessionContinuationOutcome
} from './structured-agent-session-restart-continuation'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import type { AgentSessionMutationEnvelope } from '../../../shared/agent-session-wire'

type LiveSession = { journal: AgentSessionJournal; hasProviderChild: boolean; fence: number }

/** The host capabilities this needs, named so the collaborator cannot quietly grow more. */
type RestartResumeSurfaces = {
  revealSession: (sessionId: string) => Promise<{ readable: boolean }>
  /** The resume-capable hold; see the runner for why a hold and not a send. */
  hold: (sessionId: string, holderId: string) => Promise<void>
  /** The host's own send. Reached ONLY from `continueAfterRestart` — `resume` never calls it, which
   *  is what makes "automatic reconnect can never continue" structural. */
  send: (input: {
    envelope: AgentSessionMutationEnvelope
    body: AgentJournalMessageItem
  }) => Promise<{ ok: boolean; refusal?: { code: string } }>
  now: () => number
}

export type StructuredAgentSessionRestartResume = {
  recordMarkers: (trigger: AgentSessionResumeTrigger) => Promise<void>
  list: () => Promise<StructuredAgentSessionResumeCandidate[]>
  resume: (
    sessionIds: readonly string[] | undefined,
    owner: string
  ) => Promise<StructuredAgentSessionResumeOutcome[]>
  /** Reconnect, then ask each reconnected agent to carry on. A deliberate user action only. */
  continueAfterRestart: (
    sessionIds: readonly string[] | undefined,
    owner: string
  ) => Promise<{
    resumed: StructuredAgentSessionResumeOutcome[]
    continued: StructuredAgentSessionContinuationOutcome[]
  }>
  dismiss: () => Promise<number>
}

export function createStructuredAgentSessionRestartResume(
  deps: { store: AgentSessionRecordStore; adapter: StructuredAgentSessionAdapter },
  /** The host's LIVE session map — the only honest answer to "was this actually working". */
  sessions: ReadonlyMap<string, LiveSession>,
  surfaces: RestartResumeSurfaces
): StructuredAgentSessionRestartResume {
  const admission = new StructuredAgentSessionResumeAdmission()
  const itemsFor = (sessionId: string) => sessions.get(sessionId)?.journal.snapshot().items ?? []

  /** Opens any marked session this launch has not, so its journal can answer for itself. An
   *  unreadable journal leaves the predicate with one record instead of two, which refuses. */
  const revealMarked = async (): Promise<AgentSessionResumeMarker[]> => {
    const markers = deps.store.resumeMarkers.list(surfaces.now())
    for (const marker of markers) {
      if (!sessions.has(marker.sessionId)) {
        await surfaces.revealSession(marker.sessionId).catch(() => null)
      }
    }
    return markers
  }

  const derive = (
    markers: readonly AgentSessionResumeMarker[],
    leaseState: 'must-be-released' | 'may-be-held'
  ): StructuredAgentSessionResumeCandidate[] =>
    structuredAgentSessionResumableSet({
      markers,
      getRecord: deps.store.getRecord,
      supportsRecord: (record) => adapterSupportsRecord(deps.adapter, record),
      journalTurn: (sessionId) => newestStructuredAgentSessionTurn(itemsFor(sessionId)),
      latestPrompt: (sessionId) => latestStructuredAgentSessionPrompt(itemsFor(sessionId)),
      now: surfaces.now(),
      leaseState
    })

  const list = async (): Promise<StructuredAgentSessionResumeCandidate[]> =>
    derive(await revealMarked(), 'must-be-released')

  const resume = async (
    sessionIds: readonly string[] | undefined,
    owner: string
  ): Promise<StructuredAgentSessionResumeOutcome[]> => {
    const markers = await revealMarked()
    const requested = new Set(sessionIds ?? markers.map((entry) => entry.sessionId))
    // Re-derived at CLICK time, never taken from the caller: a client may name any session id,
    // and only the predicate decides which of them is allowed a provider child.
    const candidates = derive(markers, 'must-be-released').filter((candidate) =>
      requested.has(candidate.sessionId)
    )
    const outcomes = await resumeStructuredAgentSessionsFromRestart(
      {
        admission,
        consumeMarker: (sessionId) => deps.store.resumeMarkers.consume(sessionId),
        resume: (sessionId) => surfaces.hold(sessionId, `restart-resume:${sessionId}`)
      },
      candidates,
      owner
    )
    // A session whose own chat pane bound between the offer and the click is ALREADY resumed: the
    // released-lease clause drops it, and reporting nothing-happened would leave the user pressing
    // a dead button. It may be settled as the success it is — but ONLY if it satisfies every OTHER
    // clause. Gating on the live child alone would let "Resume all", which targets every marker,
    // spend markers the predicate rejected and count chats that were never eligible.
    const eligibleIfHeld = new Set(
      derive(markers, 'may-be-held').map((candidate) => candidate.sessionId)
    )
    const settled = new Set(outcomes.map((outcome) => outcome.sessionId))
    for (const sessionId of requested) {
      if (settled.has(sessionId) || !eligibleIfHeld.has(sessionId)) {
        continue
      }
      if (sessions.get(sessionId)?.hasProviderChild !== true) {
        continue
      }
      await deps.store.resumeMarkers.consume(sessionId)
      outcomes.push({
        sessionId,
        outcome: 'resumed',
        reason: 'agent_session_resume_already_live'
      })
    }
    return outcomes
  }

  /** Reconnect first, then send. Continuation is a message ON TOP of a reconnect and reuses every
   *  guard the resume path applies — eligibility, the admission gate, staggering, consume-once —
   *  rather than re-deriving any of them. A session that did not reconnect is never sent to. */
  const continueAfterRestart = async (
    sessionIds: readonly string[] | undefined,
    owner: string
  ): Promise<{
    resumed: StructuredAgentSessionResumeOutcome[]
    continued: StructuredAgentSessionContinuationOutcome[]
  }> => {
    const resumed = await resume(sessionIds, owner)
    const continued: StructuredAgentSessionContinuationOutcome[] = []
    for (const outcome of resumed) {
      if (outcome.outcome !== 'resumed') {
        continued.push({
          sessionId: outcome.sessionId,
          outcome: 'refused',
          reason: outcome.reason ?? 'agent_session_resume_refused'
        })
        continue
      }
      continued.push(
        await continueStructuredAgentSessionAfterRestart(
          {
            currentFence: (sessionId) => sessions.get(sessionId)?.fence ?? null,
            send: surfaces.send,
            note: async (sessionId, text) => {
              const session = sessions.get(sessionId)
              if (!session) {
                return
              }
              await session.journal.appendItem(
                {
                  provider: 'orca',
                  clientMessageId: `restart-continuation:${sessionId}:${surfaces.now()}`
                },
                { kind: 'status', text },
                { fence: session.fence }
              )
            },
            now: surfaces.now
          },
          outcome.sessionId
        )
      )
    }
    return { resumed, continued }
  }

  return {
    recordMarkers: (trigger) =>
      deps.store.resumeMarkers.record(
        structuredAgentSessionsWorkingAtTeardown({
          sessions,
          getRecord: deps.store.getRecord,
          trigger,
          now: surfaces.now()
        }),
        surfaces.now()
      ),
    list,
    /**
     * Turning the offer down, which SPENDS the markers.
     *
     * A prompt that returns at every launch is worse than the problem it solves. Nothing is lost by
     * spending them: the first resume-capable hold on a childless session re-acquires the provider
     * at the same proved cursor, so opening the chat still resumes it. Every live marker goes, not
     * just the eligible ones, so an ineligible marker cannot make the prompt reappear either.
     */
    dismiss: async () => {
      const markers = deps.store.resumeMarkers.list(surfaces.now())
      for (const marker of markers) {
        await deps.store.resumeMarkers.consume(marker.sessionId)
      }
      return markers.length
    },
    resume,
    continueAfterRestart
  }
}
