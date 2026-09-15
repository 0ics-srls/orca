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

type LiveSession = { journal: AgentSessionJournal; hasProviderChild: boolean }

/** The host capabilities this needs, named so the collaborator cannot quietly grow more. */
type RestartResumeSurfaces = {
  revealSession: (sessionId: string) => Promise<{ readable: boolean }>
  /** The resume-capable hold; see the runner for why a hold and not a send. */
  hold: (sessionId: string, holderId: string) => Promise<void>
  now: () => number
}

export type StructuredAgentSessionRestartResume = {
  recordMarkers: (trigger: AgentSessionResumeTrigger) => Promise<void>
  list: () => Promise<StructuredAgentSessionResumeCandidate[]>
  resume: (
    sessionIds: readonly string[] | undefined,
    owner: string
  ) => Promise<StructuredAgentSessionResumeOutcome[]>
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

  const list = async (): Promise<StructuredAgentSessionResumeCandidate[]> => {
    const now = surfaces.now()
    const markers = deps.store.resumeMarkers.list(now)
    // A marked session this launch has not opened yet cannot answer for its own turn, and an
    // unreadable journal leaves the predicate with one record instead of two — which refuses.
    for (const marker of markers) {
      if (!sessions.has(marker.sessionId)) {
        await surfaces.revealSession(marker.sessionId).catch(() => null)
      }
    }
    return structuredAgentSessionResumableSet({
      markers,
      getRecord: deps.store.getRecord,
      supportsRecord: (record) => adapterSupportsRecord(deps.adapter, record),
      journalTurn: (sessionId) => newestStructuredAgentSessionTurn(itemsFor(sessionId)),
      latestPrompt: (sessionId) => latestStructuredAgentSessionPrompt(itemsFor(sessionId)),
      now
    })
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
    resume: async (sessionIds, owner) => {
      const offered = deps.store.resumeMarkers.list(surfaces.now()).map((entry) => entry.sessionId)
      const targets = sessionIds ? [...new Set(sessionIds)] : offered
      const requested = new Set(targets)
      // Re-derived at CLICK time, never taken from the caller: a client may name any session id,
      // and only the predicate decides which of them is allowed a provider child.
      const candidates = (await list()).filter((candidate) => requested.has(candidate.sessionId))
      const outcomes = await resumeStructuredAgentSessionsFromRestart(
        {
          admission,
          consumeMarker: (sessionId) => deps.store.resumeMarkers.consume(sessionId),
          resume: (sessionId) => surfaces.hold(sessionId, `restart-resume:${sessionId}`)
        },
        candidates,
        owner
      )
      // A session whose own chat pane bound between the offer and the click is ALREADY resumed: its
      // lease went live, so the predicate drops it. Reporting that as nothing-happened leaves the
      // user pressing a button that does nothing, so settle it as the success it actually is.
      const settled = new Set(outcomes.map((outcome) => outcome.sessionId))
      for (const sessionId of targets) {
        if (settled.has(sessionId) || sessions.get(sessionId)?.hasProviderChild !== true) {
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
  }
}
