// The host's restart-resume surface: what teardown records, what may resume, and the one call that
// resumes it.
//
// TWO TIERS, deliberately. Teardown writes a durable marker; startup CLAIMS that marker into
// launch-scoped memory and deletes the durable copy in the same step. The durable fact therefore
// dies at claim time, not at use time, which is what makes a stranded marker impossible: a failed
// resume, a timed-out teardown write, or a store restored from its `.bak` can no longer leave
// something actionable behind, because nothing actionable is left on disk and the claim dies with
// the process.
//
// The marker also carries the id of the launch that wrote it, and only the launch immediately after
// it may act on it. Without that stamp a marker from an older generation stays valid for its whole
// 24h TTL — and in automatic mode it would be acted on silently.

import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { AgentSessionLaunchGeneration } from '../../runtime/agent-session-launch-generation'
import type {
  AgentSessionResumeMarker,
  AgentSessionResumeTrigger
} from '../../../shared/agent-session-resume-marker'
import {
  latestStructuredAgentSessionPrompt,
  latestStructuredAgentSessionUserItem,
  newestStructuredAgentSessionTurn
} from '../../../shared/structured-agent-session-projection'
import type {
  AgentJournalMessageItem,
  AgentJournalRenderItem
} from '../../../shared/agent-session-journal-types'
import type {
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult,
  AgentSessionSendResult
} from '../../../shared/agent-session-wire'
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
import {
  continueStructuredAgentSessionAfterRestart,
  type StructuredAgentSessionContinuationOutcome
} from './structured-agent-session-restart-continuation'
import { structuredAgentSessionsWorkingAtTeardown } from './structured-agent-session-working-at-teardown'

type LiveSession = { journal: AgentSessionJournal; hasProviderChild: boolean; fence: number }

/** The host capabilities this needs, named so the collaborator cannot quietly grow more. */
export type StructuredAgentSessionRestartResumeSurfaces = {
  revealSession: (sessionId: string) => Promise<{ readable: boolean }>
  /** The resume-capable hold; see the runner for why a hold and not a send. */
  hold: (sessionId: string, holderId: string) => Promise<void>
  release: (sessionId: string, holderId: string) => void
  /** The host's own send. Reached ONLY from `continueAfterRestart` — `resume` never calls it, which
   *  is what makes "automatic reconnect can never continue" structural.
   *
   *  Typed against the wire result rather than a hand-written subset: an narrower local shape hid
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
  deps: {
    store: AgentSessionRecordStore
    adapter: StructuredAgentSessionAdapter
    /** Absent only where a host is built without the runtime wiring it — a test harness. The
     *  fallback proves no adjacency, so such a host claims nothing. */
    launchGeneration?: AgentSessionLaunchGeneration
  },
  /** The host's LIVE session map — the only honest answer to "was this actually working". */
  sessions: ReadonlyMap<string, LiveSession>,
  surfaces: StructuredAgentSessionRestartResumeSurfaces
): StructuredAgentSessionRestartResume {
  const admission = new StructuredAgentSessionResumeAdmission()
  // `previous: null` accepts nothing, and markers stamped `unproven` can never match a real launch
  // id, so an unwired host neither claims nor creates anything actionable.
  const launch = deps.launchGeneration ?? { current: 'unproven', previous: null }

  /** The claimed set: markers this launch owns, held only in memory. Null until the claim runs. */
  let claimed: AgentSessionResumeMarker[] | null = null
  let claiming: Promise<void> | undefined

  /**
   * Claims the previous launch's markers exactly once, and deletes EVERY durable marker in the
   * same step — including ones this launch refuses, so a non-adjacent marker cannot be re-examined
   * by a later launch either.
   *
   * Fails closed: an unprovable adjacency (`previous === null`) claims nothing, and a clear that
   * throws claims nothing rather than proceeding with markers still live on disk.
   */
  const claimMarkers = async (): Promise<AgentSessionResumeMarker[]> => {
    if (claimed) {
      return claimed
    }
    claiming ??= (async () => {
      const stored = deps.store.resumeMarkers.list(surfaces.now())
      const adjacent =
        launch.previous === null
          ? []
          : stored.filter((marker) => marker.launchId === launch.previous)
      try {
        await deps.store.resumeMarkers.clear()
        claimed = adjacent
      } catch {
        claimed = []
      }
    })()
    await claiming
    return claimed ?? []
  }

  /** Spends one claimed marker. In memory, because the durable copy is already gone. */
  const spendClaimed = (sessionId: string): boolean => {
    const before = claimed?.length ?? 0
    claimed = (claimed ?? []).filter((marker) => marker.sessionId !== sessionId)
    return claimed.length < before
  }

  /** Opens any claimed session this launch has not, so its journal can answer for itself. An
   *  unreadable journal leaves the predicate with one record instead of two, which refuses. */
  const revealClaimed = async (): Promise<AgentSessionResumeMarker[]> => {
    const markers = await claimMarkers()
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
  ): StructuredAgentSessionResumeCandidate[] => {
    const items = new Map<string, AgentJournalRenderItem[]>()
    const itemsFor = (sessionId: string): AgentJournalRenderItem[] => {
      let snapshot = items.get(sessionId)
      if (!snapshot) {
        snapshot = sessions.get(sessionId)?.journal.snapshot().items ?? []
        items.set(sessionId, snapshot)
      }
      return snapshot
    }
    return structuredAgentSessionResumableSet({
      markers,
      getRecord: deps.store.getRecord,
      supportsRecord: (record) => adapterSupportsRecord(deps.adapter, record),
      journalTurn: (sessionId) => newestStructuredAgentSessionTurn(itemsFor(sessionId)),
      journalSubmission: (sessionId, clientMessageId) =>
        sessions
          .get(sessionId)
          ?.journal.submissions()
          .find((submission) => submission.clientMessageId === clientMessageId) ?? null,
      latestPrompt: (sessionId) => latestStructuredAgentSessionPrompt(itemsFor(sessionId)),
      latestUserItemId: (sessionId) =>
        latestStructuredAgentSessionUserItem(itemsFor(sessionId))?.itemId ?? null,
      now: surfaces.now(),
      leaseState
    })
  }

  const list = async (): Promise<StructuredAgentSessionResumeCandidate[]> =>
    derive(await revealClaimed(), 'must-be-released')

  const run = async (
    sessionIds: readonly string[] | undefined,
    owner: string,
    afterAcquire?: (marker: AgentSessionResumeMarker) => Promise<void>
  ): Promise<StructuredAgentSessionResumeOutcome[]> => {
    const markers = await revealClaimed()
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
          return !!marker && derive([marker], leaseState).length === 1 && spendClaimed(sessionId)
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
    const continued: StructuredAgentSessionContinuationOutcome[] = []
    const resumed = await run(sessionIds, owner, async (marker) => {
      continued.push(
        await continueStructuredAgentSessionAfterRestart(
          {
            currentFence: (sessionId) => sessions.get(sessionId)?.fence ?? null,
            send: (input) =>
              surfaces.send({
                ...input,
                // Acquisition reconciles history; validate again inside the serialized send.
                beforeRun: () => {
                  if (derive([marker], 'may-be-held').length !== 1) {
                    throw new Error('agent_session_restart_work_superseded')
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
    recordMarkers: (trigger) =>
      deps.store.resumeMarkers.record(
        structuredAgentSessionsWorkingAtTeardown({
          sessions,
          getRecord: deps.store.getRecord,
          trigger,
          launchId: launch.current,
          now: surfaces.now()
        }),
        surfaces.now()
      ),
    list,
    /**
     * Turning the offer down, which spends the claim.
     *
     * A prompt that returns at every launch is worse than the problem it solves. Nothing is lost:
     * the first resume-capable hold on a childless session re-acquires the provider at the same
     * proved cursor, so opening the chat still reconnects it. The durable markers are already gone
     * — the claim deleted them — so this only has to empty the launch-scoped set.
     */
    dismiss: async () => {
      const markers = await claimMarkers()
      const spent = markers.length
      claimed = []
      return spent
    },
    resume: (sessionIds, owner) => run(sessionIds, owner),
    continueAfterRestart
  }
}
