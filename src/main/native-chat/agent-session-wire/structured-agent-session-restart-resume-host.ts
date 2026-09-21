// Recovery offers live in memory after an atomic take of the advisory capsule. Whatever the offer
// still owes is written back during orderly teardown; a crash after take can still lose it.

import { randomUUID } from 'node:crypto'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { AgentSessionRecoveryCapsule } from '../../runtime/agent-session-recovery-capsule'
import type {
  AgentSessionResumeMarker,
  AgentSessionResumeTrigger
} from '../../../shared/agent-session-resume-marker'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import type {
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult,
  AgentSessionSendResult
} from '../../../shared/agent-session-wire'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { createStructuredAgentSessionRestartCandidateReader } from './structured-agent-session-restart-candidates'
import { createStructuredAgentSessionRestartClaim } from './structured-agent-session-restart-claim'
import type { StructuredAgentSessionResumeCandidate } from './structured-agent-session-restart-resume-set'
import {
  resumeStructuredAgentSessionsFromRestart,
  StructuredAgentSessionResumeAdmission,
  type StructuredAgentSessionResumeOutcome
} from './structured-agent-session-restart-resume-runner'
import {
  continueStructuredAgentSessionAfterRestart,
  RestartContinuationSupersededError,
  type StructuredAgentSessionContinuationOutcome
} from './structured-agent-session-restart-continuation'
import { structuredAgentSessionsWorkingAtTeardown } from './structured-agent-session-working-at-teardown'

type LiveSession = { journal: AgentSessionJournal; hasProviderChild: boolean; fence: number }

/** The host capabilities this needs, named so the collaborator cannot quietly grow more. */
export type StructuredAgentSessionRestartResumeSurfaces = {
  publish: (sessionId: string, journal: AgentSessionJournal) => void
  revealSession: (sessionId: string) => Promise<{ readable: boolean }>
  /** The resume-capable hold; see the runner for why a hold and not a send. */
  hold: (sessionId: string, holderId: string) => Promise<void>
  release: (sessionId: string, holderId: string) => void
  /** The host's own send. Reached ONLY from `continueAfterRestart`, so reattaching on its own sends
   *  nothing — but an opted-in launch calls `continueAfterRestart` too, so this is not a guarantee
   *  about settings; see the continuation module for why that is acceptable.
   *
   *  Typed against the wire result rather than a hand-written subset: a narrower local shape hid
   *  `value.submission` here once, and the continuation reads it. */
  send: (input: {
    envelope: AgentSessionMutationEnvelope
    body: AgentJournalMessageItem
    beforeRun?: () => void
  }) => Promise<AgentSessionMutationResult<AgentSessionSendResult>>
  /** The host's existing settlement waiter. A send resolves while its dispatch is still pending, so
   *  this is what turns that starting state into a verdict. */
  awaitSendSettlement: (
    sessionId: string,
    clientMessageId: string
  ) => Promise<{ value: AgentSessionSendResult } | undefined>
  /** Where a failed journal note is reported. */
  onNoteFailed: (sessionId: string, error: unknown) => void
  now: () => number
}

export type StructuredAgentSessionRestartResume = {
  captureMarkers: (trigger: AgentSessionResumeTrigger) => void
  confirmStoppedMarker: (sessionId: string) => void
  recordMarkers: () => Promise<void>
  list: () => Promise<StructuredAgentSessionResumeCandidate[]>
  resume: (
    sessionIds: readonly string[] | undefined,
    owner: string
  ) => Promise<StructuredAgentSessionResumeOutcome[]>
  /** Reattach, then ask each reattached agent to carry on — what the UI calls resuming, whether
   *  the user pressed it or opted into it happening at launch. */
  continueAfterRestart: (
    sessionIds: readonly string[] | undefined,
    owner: string
  ) => Promise<{
    resumed: StructuredAgentSessionResumeOutcome[]
    continued: StructuredAgentSessionContinuationOutcome[]
  }>
  /** A resume-capable hold handed this session its provider child back, which is the recovery the
   *  offer existed to perform. Stops advertising it; the marker stays valid evidence. */
  recoveredByHold: (sessionId: string) => void
  dismiss: () => Promise<number>
}

export function createStructuredAgentSessionRestartResume(
  deps: {
    store: AgentSessionRecordStore
    adapter: StructuredAgentSessionAdapter
    recoveryCapsule?: Pick<AgentSessionRecoveryCapsule, 'take' | 'record'>
  },
  /** The host's LIVE session map — the only honest answer to "was this actually working". */
  sessions: ReadonlyMap<string, LiveSession>,
  surfaces: StructuredAgentSessionRestartResumeSurfaces
): StructuredAgentSessionRestartResume {
  const admission = new StructuredAgentSessionResumeAdmission()
  const teardownId = randomUUID()
  let teardownMarkers = new Map<string, AgentSessionResumeMarker>()
  const confirmedMarkers = new Map<string, AgentSessionResumeMarker>()
  const claim = createStructuredAgentSessionRestartClaim({
    take: () => deps.recoveryCapsule?.take(surfaces.now()),
    isOpen: (sessionId) => sessions.has(sessionId),
    open: (sessionId) => surfaces.revealSession(sessionId)
  })

  // The predicate's reader, built once: the offer, the click and the write-back all ask it, and a
  // second copy is how two of them come to disagree about what is resumable.
  const derive = createStructuredAgentSessionRestartCandidateReader({
    sessions,
    getRecord: deps.store.getRecord,
    adapter: deps.adapter,
    now: surfaces.now
  })

  const list = async (): Promise<StructuredAgentSessionResumeCandidate[]> => {
    await claim.evidence()
    return derive(claim.offered(), 'must-be-released')
  }

  const run = async (
    sessionIds: readonly string[] | undefined,
    owner: string,
    afterAcquire?: (marker: AgentSessionResumeMarker) => Promise<void>
  ): Promise<StructuredAgentSessionResumeOutcome[]> => {
    const markers = await claim.evidence()
    const requested = new Set(sessionIds ?? markers.map((entry) => entry.sessionId))
    // Re-derived at CLICK time, never taken from the caller: a client may name any session id,
    // and only the predicate decides which of them is allowed a provider child.
    const released = new Set(derive(markers, 'must-be-released').map((entry) => entry.sessionId))
    const candidates = derive(markers, 'may-be-held').filter(
      (candidate) =>
        requested.has(candidate.sessionId) &&
        (released.has(candidate.sessionId) ||
          sessions.get(candidate.sessionId)?.hasProviderChild === true)
    )
    const markersBySession = new Map(markers.map((marker) => [marker.sessionId, marker]))
    return resumeStructuredAgentSessionsFromRestart(
      {
        admission,
        consumeMarker: async (sessionId) => {
          const marker = markersBySession.get(sessionId)
          const leaseState =
            sessions.get(sessionId)?.hasProviderChild === true ? 'may-be-held' : 'must-be-released'
          return !!marker && derive([marker], leaseState).length === 1 && claim.spend(sessionId)
        },
        resume: async (sessionId) => {
          const holder = `restart-resume:${sessionId}`
          try {
            await surfaces.hold(sessionId, holder)
            const marker = markersBySession.get(sessionId)
            if (marker) {
              await afterAcquire?.(marker)
            }
          } finally {
            // Pane holds and active turns take over; otherwise the normal idle grace applies.
            surfaces.release(sessionId, holder)
          }
        }
      },
      candidates,
      owner
    )
  }

  /** Reattach first, then send. Continuation is a message ON TOP of a reattach and reuses every
   *  guard the resume path applies — eligibility, the admission gate, staggering, consume-once —
   *  rather than re-deriving any of them. A session that did not reattach is never sent to. */
  const continueAfterRestart = async (
    sessionIds: readonly string[] | undefined,
    owner: string
  ): Promise<{
    resumed: StructuredAgentSessionResumeOutcome[]
    continued: StructuredAgentSessionContinuationOutcome[]
  }> => {
    const continued: StructuredAgentSessionContinuationOutcome[] = []
    const resumed = await run(sessionIds, owner, async (marker) => {
      continued.push(
        await continueStructuredAgentSessionAfterRestart(
          {
            currentFence: (sessionId) => sessions.get(sessionId)?.fence ?? null,
            send: (input) =>
              surfaces.send({
                ...input,
                // The pending continuation itself is not newer user work.
                beforeRun: () => {
                  const options = { pendingContinuationId: input.envelope.clientOperationId }
                  if (derive([marker], 'may-be-held', options).length !== 1) {
                    throw new RestartContinuationSupersededError()
                  }
                }
              }),
            awaitSettlement: async (sessionId, clientMessageId) =>
              (await surfaces.awaitSendSettlement(sessionId, clientMessageId))?.value.submission,
            onNoteFailed: surfaces.onNoteFailed,
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
              surfaces.publish(sessionId, session.journal)
            }
          },
          marker.sessionId,
          marker
        )
      )
    })
    for (const outcome of resumed) {
      if (outcome.outcome !== 'resumed') {
        continued.push({
          sessionId: outcome.sessionId,
          outcome: 'refused',
          reason: outcome.reason ?? 'agent_session_resume_refused'
        })
      }
    }
    return { resumed, continued }
  }

  return {
    captureMarkers: (trigger) => {
      confirmedMarkers.clear()
      teardownMarkers.clear()
      teardownMarkers = new Map(
        structuredAgentSessionsWorkingAtTeardown({
          sessions,
          getRecord: deps.store.getRecord,
          trigger,
          teardownId,
          now: surfaces.now()
        }).map((marker) => [marker.sessionId, marker])
      )
    },
    confirmStoppedMarker: (sessionId) => {
      const marker = teardownMarkers.get(sessionId)
      // Eviction has stopped the provider and drained its tail, but has not cancelled prompts yet.
      teardownMarkers.delete(sessionId)
      try {
        if (marker && derive([marker], 'may-be-held', { providerStopped: true }).length === 1) {
          confirmedMarkers.set(sessionId, marker)
        }
      } catch {
        console.warn('[structured-agent-session] recovery witness validation failed')
      }
    },
    recordMarkers: async () => {
      // A snoozed offer survives quit, which is why this reads the capsule instead of replacing it.
      let carried: AgentSessionResumeMarker[] = []
      try {
        const owed = await claim.owed()
        if (owed.unreadable) {
          // The durable copy is intact and unknowable, so only this teardown's own witnesses may go
          // out — and with none of those, writing at all would delete an offer nobody here can see.
          if (confirmedMarkers.size === 0) {
            return
          }
        } else if (owed.claimed) {
          // RE-DERIVED rather than round-tripped, so a marker the predicate has come to refuse is
          // not handed to the next launch to refuse again.
          const stillResumable = new Set(
            derive(owed.markers, 'must-be-released').map((candidate) => candidate.sessionId)
          )
          carried = owed.markers.filter((marker) => stillResumable.has(marker.sessionId))
        } else {
          // Nothing here read the offer, so no journal was opened to judge it by and re-deriving
          // would refuse every marker — deleting a recovery the user was never shown.
          carried = owed.markers
        }
      } catch {
        console.warn('[structured-agent-session] re-deriving the snoozed offer failed')
      }
      const markers = new Map<string, AgentSessionResumeMarker>()
      for (const marker of carried) {
        markers.set(marker.sessionId, marker)
      }
      // Last write wins, and THIS teardown's witness is the fresh one: it describes the work that
      // was actually interrupted, where a carried marker describes a turn that ended launches ago.
      for (const [sessionId, marker] of confirmedMarkers) {
        markers.set(sessionId, marker)
      }
      await deps.recoveryCapsule?.record([...markers.values()], surfaces.now())
    },
    list,
    recoveredByHold: claim.recover,
    /**
     * Turning the offer down for good. Closing the dialog is a snooze — those markers stay claimed
     * and are written back at quit — so this is the only path that abandons them outright.
     *
     * Nothing is lost either way: the first resume-capable hold on a childless session re-acquires
     * the provider at the same proved cursor, and that acquisition retires the claim too.
     */
    dismiss: claim.abandon,
    resume: (sessionIds, owner) => run(sessionIds, owner),
    continueAfterRestart
  }
}
