// The restart-resume safety rules, stated as refusals.
//
// Every negative case here is a session that MUST NOT get a provider child back. Resuming one that
// was not working spends the user's tokens and can make an agent redo destructive work it already
// finished; missing one is an annoyance. Each test removes exactly one input from an otherwise
// resumable session, so deleting the matching guard turns that test red.

import { describe, expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import {
  AGENT_SESSION_RESUME_MARKER_TTL_MS,
  type AgentSessionResumeMarker
} from '../../../shared/agent-session-resume-marker'
import { newestStructuredAgentSessionTurnId } from '../../../shared/structured-agent-session-live-turn'
import { structuredAgentSessionResumableSet } from './structured-agent-session-restart-resume-set'
import {
  resumeStructuredAgentSessionsFromRestart,
  StructuredAgentSessionResumeAdmission,
  STRUCTURED_AGENT_SESSION_RESUME_CONCURRENCY,
  STRUCTURED_AGENT_SESSION_RESUME_IN_PROGRESS
} from './structured-agent-session-restart-resume-runner'
import { structuredAgentSessionsWorkingAtTeardown } from './structured-agent-session-working-at-teardown'
import { createStructuredAgentSessionRestartResume } from './structured-agent-session-restart-resume-host'

const SESSION = 'session-working-1'
const THREAD = 'thread-1'
const HANDLE_KEY = `codex:${JSON.stringify(THREAD)}`
const NOW = 1_700_000_000_000

function turnItem(
  turnId: string,
  state: 'running' | 'completed' | 'interrupted'
): AgentJournalRenderItem {
  return {
    itemId: `turn:${turnId}`,
    revision: 1,
    body: { kind: 'turn', turnId, state },
    sequence: 1,
    observedAt: NOW
  }
}

function record(overrides: { chain?: AgentSessionRecord['providerHandleChain'] } = {}) {
  return {
    schemaVersion: 2,
    sessionId: SESSION,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'git-worktree'
    },
    provider: 'codex',
    providerHandleChain: overrides.chain ?? [
      {
        linkId: 'link-1',
        handle: { provider: 'codex', threadId: THREAD },
        origin: 'created',
        mintedAtFence: 1,
        observedAt: NOW
      }
    ],
    accountHome: { variable: 'CODEX_HOME', path: '/home/codex' },
    lease: {
      sessionId: SESSION,
      runtimeKind: 'native',
      runtimeFence: 1,
      handoffStage: null,
      provenHandleLinkId: null,
      ownerProcess: null,
      reservedSpawnToken: null,
      leaseDeadlineAt: NOW,
      lastRenewedAt: NOW,
      handoffOperationId: null,
      journalCheckpoint: null,
      claimKeyId: 'key-1',
      claimStatus: 'released',
      unreconciled: false,
      deathEvidence: null
    },
    createdAt: NOW,
    updatedAt: NOW
  } as unknown as AgentSessionRecord
}

function journal(items: AgentJournalRenderItem[], isReadOnly = false) {
  return { isReadOnly, snapshot: () => ({ items, submissions: [] }) } as never
}

function marker(overrides: Partial<AgentSessionResumeMarker> = {}): AgentSessionResumeMarker {
  return {
    sessionId: SESSION,
    turnId: 'turn-1',
    recordedAt: NOW,
    trigger: 'quit',
    providerHandleKey: HANDLE_KEY,
    ...overrides
  }
}

function resumableSet(input: {
  markers: AgentSessionResumeMarker[]
  items?: AgentJournalRenderItem[]
  chain?: AgentSessionRecord['providerHandleChain']
  now?: number
}) {
  const items = input.items ?? [turnItem('turn-1', 'interrupted')]
  return structuredAgentSessionResumableSet({
    markers: input.markers,
    getRecord: () => record(input.chain === undefined ? {} : { chain: input.chain }),
    supportsRecord: () => true,
    journalTurnId: () => newestStructuredAgentSessionTurnId(items),
    latestPrompt: () => 'fix the auth bug',
    now: input.now ?? NOW
  })
}

describe('deriving what was working at teardown', () => {
  it('marks a session this host was running a turn for', () => {
    const markers = structuredAgentSessionsWorkingAtTeardown({
      sessions: new Map([
        [SESSION, { journal: journal([turnItem('turn-1', 'running')]), hasProviderChild: true }]
      ]),
      getRecord: () => record(),
      trigger: 'quit',
      now: NOW
    })

    expect(markers).toEqual([
      {
        sessionId: SESSION,
        turnId: 'turn-1',
        recordedAt: NOW,
        trigger: 'quit',
        providerHandleKey: HANDLE_KEY
      }
    ])
  })

  it('carries the update trigger so the surface can say the restart was not the user choice', () => {
    const [recorded] = structuredAgentSessionsWorkingAtTeardown({
      sessions: new Map([
        [SESSION, { journal: journal([turnItem('turn-1', 'running')]), hasProviderChild: true }]
      ]),
      getRecord: () => record(),
      trigger: 'update',
      now: NOW
    })

    expect(recorded?.trigger).toBe('update')
  })

  it('marks nothing for an idle session', () => {
    expect(
      structuredAgentSessionsWorkingAtTeardown({
        sessions: new Map([[SESSION, { journal: journal([]), hasProviderChild: true }]]),
        getRecord: () => record(),
        trigger: 'quit',
        now: NOW
      })
    ).toEqual([])
  })

  it('marks nothing for a turn that completed before the quit', () => {
    expect(
      structuredAgentSessionsWorkingAtTeardown({
        sessions: new Map([
          [SESSION, { journal: journal([turnItem('turn-1', 'completed')]), hasProviderChild: true }]
        ]),
        getRecord: () => record(),
        trigger: 'quit',
        now: NOW
      })
    ).toEqual([])
  })

  // The user's stated fear. A journal restored for READING carries whatever `running` row an older
  // crash left behind, and it is the live `hasProviderChild` — not that row — that decides.
  it('marks nothing for a stale running row this host was not executing', () => {
    expect(
      structuredAgentSessionsWorkingAtTeardown({
        sessions: new Map([
          [SESSION, { journal: journal([turnItem('turn-1', 'running')]), hasProviderChild: false }]
        ]),
        getRecord: () => record(),
        trigger: 'quit',
        now: NOW
      })
    ).toEqual([])
  })

  it('marks nothing for a session that never proved a provider cursor', () => {
    expect(
      structuredAgentSessionsWorkingAtTeardown({
        sessions: new Map([
          [SESSION, { journal: journal([turnItem('turn-1', 'running')]), hasProviderChild: true }]
        ]),
        getRecord: () => record({ chain: [] }),
        trigger: 'quit',
        now: NOW
      })
    ).toEqual([])
  })
})

describe('the resumable set', () => {
  it('offers a genuinely working session exactly once', () => {
    const candidates = resumableSet({ markers: [marker()] })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      sessionId: SESSION,
      turnId: 'turn-1',
      trigger: 'quit',
      latestPrompt: 'fix the auth bug'
    })
  })

  // No marker means no teardown ever observed this session working, whatever its journal says.
  it('offers nothing for a stale running row with no marker', () => {
    expect(resumableSet({ markers: [], items: [turnItem('turn-1', 'running')] })).toEqual([])
  })

  it('refuses when the marker and the journal name different turns', () => {
    expect(
      resumableSet({
        markers: [marker({ turnId: 'turn-9' })],
        items: [turnItem('turn-1', 'interrupted')]
      })
    ).toEqual([])
  })

  it('refuses when the journal cannot answer for any turn', () => {
    expect(resumableSet({ markers: [marker()], items: [] })).toEqual([])
  })

  it('refuses when the session has no resume cursor', () => {
    expect(resumableSet({ markers: [marker()], chain: [] })).toEqual([])
  })

  // A cursor that moved since teardown is a different conversation than the one we marked.
  it('refuses when the resume cursor drifted after the marker was written', () => {
    expect(
      resumableSet({ markers: [marker({ providerHandleKey: 'codex:"other-thread"' })] })
    ).toEqual([])
  })

  it('refuses a marker that has outlived its expiry', () => {
    expect(
      resumableSet({ markers: [marker()], now: NOW + AGENT_SESSION_RESUME_MARKER_TTL_MS + 1 })
    ).toEqual([])
  })
})

describe('the restart-resume surface', () => {
  function surface(input: {
    markers?: AgentSessionResumeMarker[]
    sessions?: Map<string, { journal: unknown; hasProviderChild: boolean }>
  }) {
    const live = new Map((input.markers ?? [marker()]).map((entry) => [entry.sessionId, entry]))
    const recorded: AgentSessionResumeMarker[][] = []
    const held: string[] = []
    const store = {
      getRecord: () => record(),
      resumeMarkers: {
        list: () => [...live.values()],
        record: async (markers: readonly AgentSessionResumeMarker[]) => {
          recorded.push([...markers])
          live.clear()
          markers.forEach((entry) => live.set(entry.sessionId, entry))
        },
        consume: async (sessionId: string) => live.delete(sessionId)
      }
    }
    const sessions =
      input.sessions ??
      new Map([
        [
          SESSION,
          { journal: journal([turnItem('turn-1', 'interrupted')]), hasProviderChild: false }
        ]
      ])
    return {
      restartResume: createStructuredAgentSessionRestartResume(
        { store, adapter: { supportsCreate: () => true } } as never,
        sessions as never,
        {
          revealSession: async () => ({ readable: true }),
          hold: async (sessionId: string) => {
            held.push(sessionId)
          },
          now: () => NOW
        }
      ),
      live,
      recorded,
      held
    }
  }

  it('offers and resumes an eligible session', async () => {
    const { restartResume, held } = surface({})

    expect(await restartResume.list()).toHaveLength(1)
    await restartResume.resume(undefined, 'modal')

    expect(held).toEqual([SESSION])
  })

  // Turning the prompt down must not leave anything that can bring it back next launch — including
  // a marker that was never eligible in the first place.
  it('spends every live marker on dismiss, eligible or not', async () => {
    const ineligible = marker({ sessionId: 'session-working-2', turnId: 'turn-elsewhere' })
    const { restartResume, live } = surface({ markers: [marker(), ineligible] })

    expect(await restartResume.dismiss()).toBe(2)

    expect(live.size).toBe(0)
    expect(await restartResume.list()).toEqual([])
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
        turnId: 'turn-2',
        recordedAt: NOW,
        trigger: 'update',
        providerHandleKey: HANDLE_KEY
      }
    ])
  })
})

describe('spending a marker', () => {
  function runner(overrides: { resume?: () => Promise<void>; concurrency?: number } = {}) {
    const consumed = new Set<string>()
    const resume = overrides.resume ?? vi.fn(async () => {})
    return {
      resume,
      consumed,
      deps: {
        admission: new StructuredAgentSessionResumeAdmission(),
        // Stands in for the durable store: the first caller spends it, later ones find it gone.
        consumeMarker: async (sessionId: string) => {
          if (consumed.has(sessionId)) {
            return false
          }
          consumed.add(sessionId)
          return true
        },
        resume,
        ...(overrides.concurrency === undefined ? {} : { concurrency: overrides.concurrency })
      }
    }
  }

  const candidate = (sessionId: string) => ({
    sessionId,
    workspaceId: 'workspace-1',
    agent: 'codex' as const,
    turnId: 'turn-1',
    trigger: 'quit' as const,
    recordedAt: NOW,
    latestPrompt: ''
  })

  it('resumes a candidate once and reports it', async () => {
    const { deps, resume } = runner()

    const outcomes = await resumeStructuredAgentSessionsFromRestart(
      deps,
      [candidate(SESSION)],
      'banner'
    )

    expect(outcomes).toEqual([{ sessionId: SESSION, outcome: 'resumed' }])
    expect(resume).toHaveBeenCalledOnce()
  })

  // A second relaunch finds the marker already spent; nothing may run again.
  it('refuses a marker a previous launch already consumed', async () => {
    const { deps, resume } = runner()
    await resumeStructuredAgentSessionsFromRestart(deps, [candidate(SESSION)], 'first-launch')

    const outcomes = await resumeStructuredAgentSessionsFromRestart(
      deps,
      [candidate(SESSION)],
      'second-launch'
    )

    expect(outcomes).toEqual([
      { sessionId: SESSION, outcome: 'refused', reason: 'agent_session_resume_consumed' }
    ])
    expect(resume).toHaveBeenCalledOnce()
  })

  it('spends the marker before it submits, so a crash mid-resume cannot double-fire', async () => {
    const order: string[] = []
    const { deps, consumed } = runner({
      resume: async () => {
        order.push(`consumed:${consumed.has(SESSION)}`)
        throw new Error('provider died mid-resume')
      }
    })

    const outcomes = await resumeStructuredAgentSessionsFromRestart(
      deps,
      [candidate(SESSION)],
      'banner'
    )

    expect(order).toEqual(['consumed:true'])
    expect(outcomes[0]).toMatchObject({ outcome: 'refused' })
    // Still spent after the failure: the next launch must not retry it on its own.
    expect(consumed.has(SESSION)).toBe(true)
  })

  it('refuses a second concurrent resume and names the live owner', async () => {
    let release = (): void => {}
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const { deps } = runner({ resume: () => blocked })

    const first = resumeStructuredAgentSessionsFromRestart(deps, [candidate(SESSION)], 'banner')
    await vi.waitFor(() => expect(deps.admission.liveOwner(SESSION)).toBe('banner'))
    const second = await resumeStructuredAgentSessionsFromRestart(deps, [candidate(SESSION)], 'row')
    release()
    await first

    expect(second).toEqual([
      {
        sessionId: SESSION,
        outcome: 'refused',
        reason: STRUCTURED_AGENT_SESSION_RESUME_IN_PROGRESS,
        owner: 'banner'
      }
    ])
  })

  it('staggers instead of starting every provider at once', async () => {
    let live = 0
    let peak = 0
    const { deps } = runner({
      resume: async () => {
        live += 1
        peak = Math.max(peak, live)
        await new Promise((resolve) => setTimeout(resolve, 5))
        live -= 1
      }
    })
    const candidates = Array.from({ length: 12 }, (_, index) =>
      candidate(`session-staggered-${index}`)
    )

    const outcomes = await resumeStructuredAgentSessionsFromRestart(deps, candidates, 'banner')

    // Unbounded fan-out would peak at all 12 — which is the spawn storm this exists to prevent.
    expect(peak).toBe(STRUCTURED_AGENT_SESSION_RESUME_CONCURRENCY)
    expect(outcomes).toHaveLength(candidates.length)
  })
})
