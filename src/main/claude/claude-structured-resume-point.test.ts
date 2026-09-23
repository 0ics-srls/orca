import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeStructuredSessionAdapterDeps,
  ClaudeStructuredSessionEvent
} from './claude-structured-session-adapter'
import {
  proveClaudeTranscriptBranchFromJsonl,
  replayClaudeTranscriptBranchAncestryFromJsonl
} from './claude-transcript-branch-proof'
import {
  adapterFor,
  fakeClaude,
  identityFor,
  PROVIDER_SESSION_ID,
  recordingJournalSink,
  tick
} from './claude-structured-session-test-support'

type Row = Record<string, unknown>

const row = (uuid: string, parentUuid: string | null, fields: Row): Row => ({
  parentUuid,
  isSidechain: false,
  uuid,
  sessionId: PROVIDER_SESSION_ID,
  ...fields
})
const user = (uuid: string, parentUuid: string | null): Row =>
  row(uuid, parentUuid, { type: 'user', message: { role: 'user', content: uuid } })
const assistant = (uuid: string, parentUuid: string): Row =>
  row(uuid, parentUuid, { type: 'assistant', message: { role: 'assistant', content: [] } })
const hookAttachment = (uuid: string, parentUuid: string): Row =>
  row(uuid, parentUuid, { type: 'attachment', attachment: { type: 'hook_success' } })
const stopHookSummary = (uuid: string, parentUuid: string): Row =>
  row(uuid, parentUuid, { type: 'system', subtype: 'stop_hook_summary', hookCount: 1 })
const marker = (leafUuid: string): Row => ({
  type: 'last-prompt',
  leafUuid,
  sessionId: PROVIDER_SESSION_ID
})
const jsonl = (rows: Row[]): string => `${rows.map((entry) => JSON.stringify(entry)).join('\n')}\n`

// Shaped like the stranded production transcript: Claude's marker names a stop-hook summary, and
// every later resume at that stale cursor started a new branch off it.
const FIRST_DAY: Row[] = [
  user('u1', null),
  assistant('a1', 'u1'),
  hookAttachment('h1', 'a1'),
  stopHookSummary('s1', 'h1'),
  marker('s1')
]
const LOST_BRANCH: Row[] = [
  user('u2', 's1'),
  assistant('a2', 'u2'),
  stopHookSummary('s2', 'a2'),
  marker('s2')
]
const LATEST_BRANCH: Row[] = [
  user('u3', 's1'),
  assistant('a3', 'u3'),
  hookAttachment('h3', 'a3'),
  marker('h3')
]
const TRANSCRIPT = jsonl([...FIRST_DAY, ...LOST_BRANCH, ...LATEST_BRANCH])

/** The production reader's contract, over an in-memory transcript. */
function transcriptReader(
  contents: () => string
): NonNullable<ClaudeStructuredSessionAdapterDeps['readTranscriptLeaf']> {
  return async ({ providerSessionId, previousLeafUuid, intentionalRewindUuid }) =>
    proveClaudeTranscriptBranchFromJsonl({
      contents: contents(),
      providerSessionId,
      previousLeafUuid,
      ...(intentionalRewindUuid === undefined ? {} : { intentionalRewindUuid })
    }).leafUuid
}

async function resumeAt(
  storedLeafUuid: string | null,
  readTranscriptLeaf: ClaudeStructuredSessionAdapterDeps['readTranscriptLeaf'],
  persisted: unknown[] = []
) {
  const claude = fakeClaude()
  const adapter = adapterFor(
    claude,
    {
      resumed: true,
      resumeLeafUuid: storedLeafUuid,
      options: storedLeafUuid === null ? {} : { resumeSessionAt: storedLeafUuid }
    },
    [],
    persisted,
    undefined,
    readTranscriptLeaf
  )
  const acquisition = await adapter.acquire({
    identity: identityFor(),
    fence: 7,
    spawnToken: 'spawn-7',
    events: recordingJournalSink()
  })
  return { adapter, claude, acquisition }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Claude transcript leaf is a message', () => {
  it('never records a hook summary or attachment as the leaf', () => {
    const firstDay = jsonl(FIRST_DAY)
    expect(
      proveClaudeTranscriptBranchFromJsonl({
        contents: firstDay,
        providerSessionId: PROVIDER_SESSION_ID,
        previousLeafUuid: null
      })
    ).toEqual({ leafUuid: 'a1', relation: 'initial' })
    expect(
      proveClaudeTranscriptBranchFromJsonl({
        contents: TRANSCRIPT,
        providerSessionId: PROVIDER_SESSION_ID,
        previousLeafUuid: null
      }).leafUuid
    ).toBe('a3')
  })

  it('advances a cursor stored as a hook summary to the latest message after it', () => {
    expect(
      proveClaudeTranscriptBranchFromJsonl({
        contents: TRANSCRIPT,
        providerSessionId: PROVIDER_SESSION_ID,
        previousLeafUuid: 's1'
      })
    ).toEqual({ leafUuid: 'a3', relation: 'descendant' })
    expect(
      proveClaudeTranscriptBranchFromJsonl({
        contents: jsonl(FIRST_DAY),
        providerSessionId: PROVIDER_SESSION_ID,
        previousLeafUuid: 's1'
      })
    ).toEqual({ leafUuid: 'a1', relation: 'same' })
  })

  it('keeps a history window anchored at a legacy hook-summary cursor consistent', () => {
    const chainFrom = (contents: string) =>
      replayClaudeTranscriptBranchAncestryFromJsonl({
        contents,
        providerSessionId: PROVIDER_SESSION_ID,
        previousLeafUuid: 's1',
        ancestryAnchorUuid: 's1',
        onAncestorRecord: () => {}
      }).chain
    expect(chainFrom(TRANSCRIPT)).toEqual(['a3', 'u3'])
    expect(chainFrom(jsonl(FIRST_DAY))).toEqual([])
  })
})

describe('Claude plain resume re-derives its point from the transcript', () => {
  it('resumes a stored hook-summary cursor at the latest message instead', async () => {
    const { adapter, claude, acquisition } = await resumeAt(
      's1',
      transcriptReader(() => TRANSCRIPT)
    )
    try {
      expect(claude.connections[0]!.launch.options).toMatchObject({ resumeSessionAt: 'a3' })
      expect(acquisition.link.handle).toMatchObject({ leafUuid: 'a3' })
    } finally {
      await adapter.closeAll()
    }
  })

  it('does not truncate at a stale cursor that is still a valid message', async () => {
    const { adapter, claude } = await resumeAt(
      'a1',
      transcriptReader(() => TRANSCRIPT)
    )
    try {
      expect(claude.connections[0]!.launch.options).toMatchObject({ resumeSessionAt: 'a3' })
    } finally {
      await adapter.closeAll()
    }
  })

  it('re-proves from the root when the stored cursor is missing from the transcript', async () => {
    const { adapter, claude } = await resumeAt(
      'gone',
      transcriptReader(() => TRANSCRIPT)
    )
    try {
      expect(claude.connections[0]!.launch.options).toMatchObject({ resumeSessionAt: 'a3' })
    } finally {
      await adapter.closeAll()
    }
  })

  it('resumes by session id alone when the transcript cannot vouch for any point', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unreadable = async (): Promise<string | null> => {
      throw new Error('transcript unreadable')
    }
    const { adapter, claude, acquisition } = await resumeAt('s1', unreadable)
    try {
      expect(claude.connections[0]!.launch.options).not.toHaveProperty('resumeSessionAt')
      expect(acquisition.link.handle).toMatchObject({ leafUuid: null })
      // The fallback leaves a trail: a silent one hides which chats stopped resuming at a point.
      expect(warn).toHaveBeenCalledWith(
        '[claude-resume-point] transcript cannot vouch for a point; resuming by id:',
        expect.objectContaining({ storedLeafUuid: 's1', reason: expect.any(Error) })
      )
    } finally {
      await adapter.closeAll()
    }
  })

  it('resumes by session id alone when compaction cut the stored cursor off the tip', async () => {
    const compacted = jsonl([
      ...FIRST_DAY,
      row('cb', null, { type: 'system', subtype: 'compact_boundary', logicalParentUuid: 's1' }),
      user('u5', 'cb'),
      assistant('a5', 'u5'),
      marker('a5')
    ])
    const { adapter, claude } = await resumeAt(
      's1',
      transcriptReader(() => compacted)
    )
    try {
      expect(claude.connections[0]!.launch.options).not.toHaveProperty('resumeSessionAt')
    } finally {
      await adapter.closeAll()
    }
  })

  it('still resumes an intentional rewind at the chosen point', async () => {
    let contents = TRANSCRIPT
    const claude = fakeClaude()
    const adapter = adapterFor(
      claude,
      { resumed: true, resumeLeafUuid: 'a3', options: { resumeSessionAt: 'a3' } },
      [],
      [],
      undefined,
      transcriptReader(() => contents)
    )
    try {
      const rewound = adapter.acquire({
        identity: identityFor(),
        fence: 7,
        spawnToken: 'spawn-7',
        events: recordingJournalSink(),
        rewind: {
          targetUuid: 'u3',
          previousLeafUuid: 'a3',
          onProved: async () => {}
        }
      })
      // Claude marks the rewound point once it resumes there.
      contents = `${TRANSCRIPT}${JSON.stringify(marker('u3'))}\n`
      const acquisition = await rewound
      expect(claude.connections[0]!.launch.options).toMatchObject({ resumeSessionAt: 'u3' })
      expect(acquisition.link.handle).toMatchObject({ leafUuid: 'u3' })
    } finally {
      await adapter.closeAll()
    }
  })
})

describe('Claude resume point is persisted on every exit path', () => {
  const LATER_TURN: Row[] = [
    user('u4', 'h3'),
    assistant('a4', 'u4'),
    stopHookSummary('s4', 'a4'),
    marker('s4')
  ]

  /** The live stream saw the next prompt and a hook summary; the transcript also holds the reply. */
  async function liveSessionAfterTwoTurns(
    persisted: unknown[],
    readable: { transcript: boolean } = { transcript: true }
  ) {
    let contents = TRANSCRIPT
    let transcriptReadable = true
    const live = await resumeAt(
      'a3',
      async (input) => {
        if (!transcriptReadable) {
          throw new Error('transcript unreadable')
        }
        return transcriptReader(() => contents)(input)
      },
      persisted
    )
    transcriptReadable = readable.transcript
    const connection = live.claude.connections[0]!
    connection.handlers.onMessage?.({ type: 'user', session_id: PROVIDER_SESSION_ID, uuid: 'u4' })
    connection.handlers.onMessage?.({
      type: 'system',
      subtype: 'stop_hook_summary',
      session_id: PROVIDER_SESSION_ID,
      uuid: 's4'
    })
    contents = `${TRANSCRIPT}${jsonl(LATER_TURN)}`
    return live
  }

  const persistedLeaf = { providerSessionId: PROVIDER_SESSION_ID, leafUuid: 'a4', fence: 7 }

  it('on close', async () => {
    const persisted: unknown[] = []
    const { adapter } = await liveSessionAfterTwoTurns(persisted)
    await expect(adapter.closeSession('session-1')).resolves.toBe(true)
    expect(persisted).toEqual([expect.objectContaining(persistedLeaf)])
  })

  it('on an unexpected exit', async () => {
    const persisted: unknown[] = []
    const { adapter, claude } = await liveSessionAfterTwoTurns(persisted)
    claude.connections[0]!.handlers.onExit?.(new Error('claude crashed'))
    await adapter.drainObservedExits()
    await tick()
    expect(persisted).toEqual([expect.objectContaining(persistedLeaf)])
  })

  it('on an acquisition release', async () => {
    const persisted: unknown[] = []
    const { adapter } = await liveSessionAfterTwoTurns(persisted)
    await expect(adapter.releaseAcquisition({ sessionId: 'session-1' })).resolves.toBe(true)
    expect(persisted).toEqual([expect.objectContaining(persistedLeaf)])
  })

  it('on an unexpected exit whose durable write fails, still ends the session and logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const events: ClaudeStructuredSessionEvent[] = []
    const claude = fakeClaude()
    const adapter = adapterFor(
      claude,
      { resumed: true, resumeLeafUuid: 'a3', options: { resumeSessionAt: 'a3' } },
      events,
      [],
      undefined,
      transcriptReader(() => TRANSCRIPT),
      async () => {
        throw new Error('record write failed')
      }
    )
    await adapter.acquire({
      identity: identityFor(),
      fence: 7,
      spawnToken: 'spawn-7',
      events: recordingJournalSink()
    })
    claude.connections[0]!.handlers.onExit?.(new Error('claude crashed'))
    await adapter.drainObservedExits()
    await tick()
    expect(events.at(-1)).toMatchObject({ type: 'ended', cause: 'unexpected-exit' })
    expect(warn).toHaveBeenCalledWith(
      '[claude-resume-point] exit cursor was not persisted:',
      expect.objectContaining({ sessionId: 'session-1', error: expect.any(Error) })
    )
  })

  it('falls back to the last live message, never a live hook summary', async () => {
    const persisted: unknown[] = []
    const { adapter } = await liveSessionAfterTwoTurns(persisted, { transcript: false })
    await expect(adapter.closeSession('session-1')).resolves.toBe(true)
    expect(persisted).toEqual([expect.objectContaining({ leafUuid: 'u4' })])
  })
})
