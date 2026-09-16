// The claim: which markers a launch may act on at all, and what the surface does with them.
//
// Teardown's marker is durable, so on its own it is a write-ahead latch that stays actionable for a
// whole TTL. Two things bound it, and both are asserted here: it is scoped to the launch that wrote
// it, and the next launch deletes every durable copy in the same step that it claims them.

import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionResumeMarker } from '../../../shared/agent-session-resume-marker'
import { AGENT_SESSION_RESTART_CONTINUATION_MESSAGE } from '../../../shared/agent-session-restart-continuation'
import { createStructuredAgentSessionRestartResume } from './structured-agent-session-restart-resume-host'
import {
  HANDLE_ROOT,
  journal,
  LAUNCH_CURRENT,
  LAUNCH_PREVIOUS,
  liveLeaseRecord,
  marker,
  NOW,
  record,
  SESSION,
  turnItem
} from './structured-agent-session-restart-resume-test-harness'

function surface(input: {
  markers?: AgentSessionResumeMarker[]
  sessions?: Map<string, { journal: unknown; hasProviderChild: boolean }>
  record?: AgentSessionRecord
  holdFails?: boolean
  /** The launch generation the host reads. Absent means adjacent to the marker fixtures. */
  launchGeneration?: { current: string; previous: string | null }
  clearFails?: boolean
  /** What the send layer answers. Defaults to the happy path: Orca took it, the provider accepted. */
  sendResult?: {
    ok: boolean
    refusal?: { code: string }
    value?: { submission?: { dispatchState?: string; reason?: string | null } }
  }
}) {
  const live = new Map((input.markers ?? [marker()]).map((entry) => [entry.sessionId, entry]))
  const recorded: AgentSessionResumeMarker[][] = []
  const held: string[] = []
  const noted: { sessionId: string; text: string }[] = []
  const store = {
    getRecord: () => input.record ?? record(),
    resumeMarkers: {
      list: () => [...live.values()],
      record: async (markers: readonly AgentSessionResumeMarker[]) => {
        recorded.push([...markers])
        live.clear()
        markers.forEach((entry) => live.set(entry.sessionId, entry))
      },
      clear: async () => {
        if (input.clearFails) {
          throw new Error('durable store refused the clear')
        }
        live.clear()
      }
    }
  }
  const sent: { sessionId: string; text: string }[] = []
  const sessions =
    input.sessions ??
    new Map([
      [
        SESSION,
        {
          journal: journal([turnItem('turn-1', 'interrupted')]),
          hasProviderChild: false,
          fence: 1
        }
      ]
    ])
  // The note is written onto the session's own journal; intercept it there to assert attribution.
  for (const [sessionId, session] of sessions) {
    const target = Reflect.get(session, 'journal')
    if (target !== null && typeof target === 'object') {
      Reflect.set(target, 'appendItem', async (_envelope: unknown, body: unknown) => {
        noted.push({ sessionId, text: String(Reflect.get(body ?? {}, 'text')) })
      })
    }
  }
  return {
    restartResume: createStructuredAgentSessionRestartResume(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the collaborator reads only getRecord and resumeMarkers from the store, and supportsCreate from the adapter.
      {
        store,
        adapter: { supportsCreate: () => true },
        launchGeneration: input.launchGeneration ?? {
          current: LAUNCH_CURRENT,
          previous: LAUNCH_PREVIOUS
        }
      } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the live-session map is read for journal, hasProviderChild and fence only.
      sessions as never,
      {
        revealSession: async () => ({ readable: true }),
        hold: async (sessionId: string) => {
          if (input.holdFails) {
            throw new Error('provider refused the reconnect')
          }
          held.push(sessionId)
        },
        send: async ({ envelope, body }) => {
          sent.push({
            sessionId: envelope.sessionId,
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: restartContinuationBody builds exactly one text block, which is what this assertion reads.
            text: (body.blocks[0] as { text: string }).text
          })
          return (
            input.sendResult ?? { ok: true, value: { submission: { dispatchState: 'accepted' } } }
          )
        },
        now: () => NOW
      }
    ),
    live,
    recorded,
    held,
    sent,
    noted
  }
}

describe('claiming the previous launch markers', () => {
  // The adjacency proof. A marker two generations old is inside its TTL and otherwise perfectly
  // resumable; only the launch stamp separates it from one written by the quit the user just did.
  it('refuses a marker written by a launch that was not the immediately preceding one', async () => {
    const { restartResume, held } = surface({
      markers: [marker({ launchId: 'launch-two-generations-ago' })]
    })

    expect(await restartResume.list()).toEqual([])
    expect(await restartResume.resume(undefined, 'modal')).toEqual([])
    expect(held).toEqual([])
  })

  // Fail closed: a launch that cannot name its predecessor cannot prove adjacency for anything, so
  // it acts on nothing rather than on everything inside the TTL.
  it('refuses every marker when the previous launch id could not be read', async () => {
    const { restartResume, held } = surface({
      launchGeneration: { current: LAUNCH_CURRENT, previous: null }
    })

    expect(await restartResume.list()).toEqual([])
    expect(held).toEqual([])
  })

  // The write-ahead case the whole launch-scoping exists for: teardown's marker write fails or times
  // out, so the PREVIOUS generation's markers are still on disk when the app comes back. They are
  // not adjacent to the launch that is now reading them, so none of them is actionable.
  it('leaves a previous generation unactionable when the teardown write never landed', async () => {
    // Nothing was recorded at the last quit, so what survives is the generation before it.
    const { restartResume, held, live } = surface({
      markers: [marker({ launchId: 'launch-before-previous' })],
      launchGeneration: { current: LAUNCH_CURRENT, previous: LAUNCH_PREVIOUS }
    })

    expect(await restartResume.list()).toEqual([])
    expect(held).toEqual([])
    // And it is gone from disk, so the launch after this one cannot find it either.
    expect(live.size).toBe(0)
  })

  // Backup recovery is the other way a spent marker comes back: the store is restored from a copy
  // taken before the claim deleted it. The restored marker names a launch that is no longer the
  // predecessor, so it stays refused however many times it is recovered.
  it('refuses a claimed marker that a backup recovery put back on disk', async () => {
    const { restartResume, live, held } = surface({})

    expect(await restartResume.list()).toHaveLength(1)
    await restartResume.resume(undefined, 'modal')
    expect(held).toEqual([SESSION])

    // The store rolls back to its pre-claim copy, and the app launches again.
    const recovered = marker()
    const next = surface({
      markers: [recovered],
      launchGeneration: { current: 'launch-after-current', previous: LAUNCH_CURRENT }
    })

    expect(await next.restartResume.list()).toEqual([])
    expect(next.held).toEqual([])
    expect(live.size).toBe(0)
  })

  // The claim is the deletion. Everything on disk goes in one step — including markers this launch
  // refuses — so a later launch has nothing left to re-examine.
  it('deletes every durable marker at claim time, refused ones included', async () => {
    const { restartResume, live } = surface({
      markers: [marker(), marker({ sessionId: 'session-working-2', launchId: 'launch-older' })]
    })

    await restartResume.list()

    expect(live.size).toBe(0)
  })

  // Fail closed again: if the delete throws, the markers are still live on disk, so acting on them
  // would be acting on something a later launch can also act on.
  it('claims nothing when the durable clear fails', async () => {
    const { restartResume, held } = surface({ clearFails: true })

    expect(await restartResume.list()).toEqual([])
    expect(await restartResume.resume(undefined, 'modal')).toEqual([])
    expect(held).toEqual([])
  })
})

describe('the restart-resume surface', () => {
  // The structural guarantee behind "the checkbox can never continue": the reconnect path contains
  // no send at all, so no setting, and no automatic launch, can turn it into a continuation.
  it('never sends a message when reconnecting', async () => {
    const { restartResume, held, sent } = surface({})

    await restartResume.resume(undefined, 'modal')

    expect(held).toEqual([SESSION])
    expect(sent).toEqual([])
  })

  it('reconnects and then sends exactly one continuation carrying the shared message', async () => {
    const { restartResume, held, sent } = surface({})

    const result = await restartResume.continueAfterRestart(undefined, 'modal')

    expect(held).toEqual([SESSION])
    expect(sent).toEqual([{ sessionId: SESSION, text: AGENT_SESSION_RESTART_CONTINUATION_MESSAGE }])
    expect(result.continued).toEqual([{ sessionId: SESSION, outcome: 'continued' }])
  })

  // The predicate refused it, so it is not even a candidate and the loop never sees it.
  it('sends nothing to a session that was never eligible', async () => {
    const { restartResume, sent } = surface({
      markers: [marker({ work: { kind: 'turn', id: 'turn-elsewhere' } })]
    })

    const result = await restartResume.continueAfterRestart(undefined, 'modal')

    expect(sent).toEqual([])
    expect(result.continued).toEqual([])
  })

  // The case that actually exercises the gate: an ELIGIBLE session whose reconnect failed. It
  // reaches the loop as a refused outcome, and continuation must still not send to it.
  it('sends nothing to a session that did not reconnect', async () => {
    const { restartResume, sent, held } = surface({ holdFails: true })

    const result = await restartResume.continueAfterRestart(undefined, 'modal')

    expect(held).toEqual([])
    expect(sent).toEqual([])
    expect(result.continued).toEqual([
      { sessionId: SESSION, outcome: 'refused', reason: 'provider refused the reconnect' }
    ])
  })

  it('offers and resumes an eligible session', async () => {
    const { restartResume, held } = surface({})

    expect(await restartResume.list()).toHaveLength(1)
    await restartResume.resume(undefined, 'modal')

    expect(held).toEqual([SESSION])
  })

  // Turning the prompt down must not leave anything that can bring it back next launch — including
  // a marker that was never eligible in the first place.
  it('spends every live marker on dismiss, eligible or not', async () => {
    const ineligible = marker({
      sessionId: 'session-working-2',
      work: { kind: 'turn', id: 'turn-elsewhere' }
    })
    const { restartResume, live } = surface({ markers: [marker(), ineligible] })

    expect(await restartResume.dismiss()).toBe(2)

    expect(live.size).toBe(0)
    expect(await restartResume.list()).toEqual([])
  })

  // TOCTOU: the chat's own pane binds between the offer and the click, the lease goes live, and the
  // predicate drops the session. Reporting "nothing happened" would leave the user pressing a dead
  // button for a session that IS running.
  it('reports a session the chat pane already re-acquired as resumed, not as nothing', async () => {
    const { restartResume, held } = surface({
      record: liveLeaseRecord(),
      sessions: new Map([
        [SESSION, { journal: journal([turnItem('turn-1', 'interrupted')]), hasProviderChild: true }]
      ])
    })

    const outcomes = await restartResume.resume([SESSION], 'modal')

    expect(outcomes).toEqual([
      { sessionId: SESSION, outcome: 'resumed', reason: 'agent_session_resume_already_live' }
    ])
    // Spent, so the prompt cannot offer it again, and no second hold was taken. The durable copy
    // went at claim time, so what has to be empty now is the launch-scoped set.
    expect(await restartResume.dismiss()).toBe(0)
    expect(held).toEqual([])
  })

  // Relaxing the lease clause must not relax the whole predicate. "Resume all" targets every
  // marker, so a held-but-ineligible session would otherwise be consumed and counted as resumed.
  it('refuses to settle an already-live session the predicate rejects', async () => {
    const { restartResume, held } = surface({
      record: liveLeaseRecord(),
      sessions: new Map([
        [SESSION, { journal: journal([turnItem('turn-1', 'completed')]), hasProviderChild: true }]
      ])
    })

    const outcomes = await restartResume.resume(undefined, 'modal')

    expect(outcomes).toEqual([])
    // The claim survives unspent: nothing was resumed, so nothing may be spent.
    expect(await restartResume.dismiss()).toBe(1)
    expect(held).toEqual([])
  })

  // The client names ids; only the host decides which of them may have a provider child.
  it('resumes nothing for a session id the caller invented', async () => {
    const { restartResume, held } = surface({})

    const outcomes = await restartResume.resume(['session-not-offered-1'], 'modal')

    expect(outcomes).toEqual([])
    expect(held).toEqual([])
  })

  // Quitting while the prompt is open: the offered session has no provider child in THIS
  // generation, so teardown mints no marker for it and the replace-the-whole-set write clears the
  // old one. The offer is discarded rather than resurrected, and nothing can double-fire.
  it('leaves no marker behind when the user quits with the offer still open', async () => {
    const { restartResume, live, recorded } = surface({})

    await restartResume.recordMarkers('quit')

    expect(recorded).toEqual([[]])
    expect(live.size).toBe(0)
  })

  it('re-marks a session whose resume is already running when the next quit lands', async () => {
    const { restartResume, recorded } = surface({
      sessions: new Map([
        [SESSION, { journal: journal([turnItem('turn-2', 'running')]), hasProviderChild: true }]
      ])
    })

    await restartResume.recordMarkers('update')

    expect(recorded[0]).toEqual([
      {
        sessionId: SESSION,
        work: { kind: 'turn', id: 'turn-2' },
        recordedAt: NOW,
        trigger: 'update',
        launchId: LAUNCH_CURRENT,
        providerHandleRoot: HANDLE_ROOT
      }
    ])
  })
})

describe('reporting what the continuation actually did', () => {
  // The defect this exists for: the send layer answers `ok: true` the moment ORCA owns the message,
  // and the provider's own answer lives inside the submission. Reading only the envelope reports a
  // rejected dispatch as continued and stamps the journal saying the agent was asked to carry on.
  it('reports a rejected dispatch as refused and writes no note', async () => {
    const { restartResume, noted } = surface({
      sendResult: {
        ok: true,
        value: { submission: { dispatchState: 'rejected', reason: 'provider_turn_start_refused' } }
      }
    })

    const result = await restartResume.continueAfterRestart(undefined, 'modal')

    expect(result.continued).toEqual([
      { sessionId: SESSION, outcome: 'refused', reason: 'provider_turn_start_refused' }
    ])
    expect(noted).toEqual([])
  })

  it('reports a send Orca could not hand off as refused and writes no note', async () => {
    const { restartResume, noted } = surface({
      sendResult: { ok: false, refusal: { code: 'agent_session_send_refused' } }
    })

    const result = await restartResume.continueAfterRestart(undefined, 'modal')

    expect(result.continued).toEqual([
      { sessionId: SESSION, outcome: 'refused', reason: 'agent_session_send_refused' }
    ])
    expect(noted).toEqual([])
  })

  it('reports an unconfirmed dispatch as pending and writes no note', async () => {
    const { restartResume, noted } = surface({
      sendResult: { ok: true, value: { submission: { dispatchState: 'pending' } } }
    })

    const result = await restartResume.continueAfterRestart(undefined, 'modal')

    expect(result.continued).toEqual([{ sessionId: SESSION, outcome: 'pending' }])
    expect(noted).toEqual([])
  })

  // Unverifiable delivery is neither success nor failure, and a peer that reports no state at all
  // lands here too rather than defaulting into success.
  it('reports an unverifiable dispatch as unknown and writes no note', async () => {
    const { restartResume, noted } = surface({
      sendResult: { ok: true, value: { submission: { dispatchState: 'unknown' } } }
    })
    const silent = surface({ sendResult: { ok: true } })

    expect((await restartResume.continueAfterRestart(undefined, 'modal')).continued).toEqual([
      { sessionId: SESSION, outcome: 'unknown' }
    ])
    expect((await silent.restartResume.continueAfterRestart(undefined, 'modal')).continued).toEqual(
      [{ sessionId: SESSION, outcome: 'unknown' }]
    )
    expect(noted).toEqual([])
    expect(silent.noted).toEqual([])
  })

  // Only an accepted dispatch earns the note, because the note is what tells the reader of the
  // transcript that Orca, not the user, wrote the message above it.
  it('writes the attribution note only when the dispatch was accepted', async () => {
    const { restartResume, noted } = surface({
      sendResult: { ok: true, value: { submission: { dispatchState: 'accepted' } } }
    })

    const result = await restartResume.continueAfterRestart(undefined, 'modal')

    expect(result.continued).toEqual([{ sessionId: SESSION, outcome: 'continued' }])
    expect(noted).toHaveLength(1)
    expect(noted[0]?.sessionId).toBe(SESSION)
  })
})
