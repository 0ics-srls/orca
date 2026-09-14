import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type { AgentJournalCursor } from '../../../shared/agent-session-journal-types'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  oldestStructuredAgentSessionCursor,
  reduceStructuredAgentSession,
  type StructuredAgentSessionState
} from '../../../shared/structured-agent-session-reducer'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { UNEXPECTED_PROVIDER_EXIT_OUTCOME } from './structured-agent-session-dead-generation-settlement'
import {
  readAgentSessionHistory,
  readAgentSessionHydrationPage
} from './agent-session-history-page'

const SESSION = 'session-retired-provider-exit-filter'
const RETIRED_TEXT = 'Provider exited: recorded pid absent on host'
let root: string
let journal: AgentSessionJournal

async function appendStatus(clientMessageId: string, text: string): Promise<void> {
  await journal.appendItem(
    { provider: 'orca', clientMessageId },
    { kind: 'status', text },
    { fence: 8 }
  )
}

/** `legacy-<n>` writes a row carrying the retired copy; anything else stays renderable. */
async function appendRows(names: readonly string[]): Promise<void> {
  for (const name of names) {
    await (name.startsWith('legacy-')
      ? appendStatus(`restart-eviction:${SESSION}:${name.slice('legacy-'.length)}`, RETIRED_TEXT)
      : appendStatus(`kept:${name}`, `keep ${name}`))
  }
}

function orcaItemKey(clientMessageId: string): string {
  return agentJournalItemKey({ provider: 'orca', clientMessageId })
}

function sequenceOf(name: string): number {
  const itemId = orcaItemKey(`kept:${name}`)
  const found = journal.snapshot().items.find((item) => item.itemId === itemId)
  expect(found).toBeDefined()
  return found!.sequence
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-retired-provider-exit-filter-'))
  journal = await openAgentSessionJournal({
    identity: {
      sessionId: SESSION,
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'codex',
      providerHandle: { kind: 'codex', threadId: 'thread-1' }
    },
    journalDir: root
  })
})

afterEach(async () => {
  await journal.close()
  await rm(root, { recursive: true, force: true })
})

describe('retired provider-exit status filtering', () => {
  it('hides a historical restart-eviction row while rendering a genuine provider exit', async () => {
    const hidden = `restart-eviction:${SESSION}:8`
    const rendered = [
      `provider-exit:${SESSION}:7:generation-1`,
      `restart-eviction:other-session:8`,
      `restart-eviction:${SESSION}:8:suffix`,
      `restart-eviction:${SESSION}:not-a-fence`
    ]
    await appendStatus(hidden, RETIRED_TEXT)
    for (const clientMessageId of rendered) {
      await appendStatus(clientMessageId, `keep ${clientMessageId}`)
    }

    const itemIds = readAgentSessionHydrationPage(journal).items.map((item) => item.itemId)
    expect(itemIds).not.toContain(orcaItemKey(hidden))
    for (const clientMessageId of rendered) {
      expect(itemIds).toContain(orcaItemKey(clientMessageId))
    }
    // The row stays in durable history; only the projection drops it.
    expect(journal.snapshot().items.map((item) => item.itemId)).toContain(orcaItemKey(hidden))
  })

  it('renders a genuine provider death settled under the same identity shape', async () => {
    // The `restart-eviction:` id is still minted, so only the retired copy may be filtered.
    const shared = `restart-eviction:${SESSION}:8`
    await appendStatus(shared, UNEXPECTED_PROVIDER_EXIT_OUTCOME)

    const itemIds = readAgentSessionHydrationPage(journal).items.map((item) => item.itemId)
    expect(itemIds).toContain(orcaItemKey(shared))
  })

  it('hides it on forward catch-up without stalling the cursor', async () => {
    const before = journal.cursor()
    await appendStatus(`restart-eviction:${SESSION}:8`, 'Provider exited: recorded pid absent')

    const result = readAgentSessionHistory(journal, {
      sessionId: SESSION,
      direction: 'after',
      cursor: before,
      limit: 50
    })

    expect(result.ok).toBe(true)
    expect(result.page.items).toEqual([])
    expect(result.page.window.nextCursor.sequence).toBeGreaterThan(before.sequence)
  })

  it('reports end-of-history when the whole requested older window is retired copy', async () => {
    // `a`,`b` are the only history behind the legacy run, so a window of two lands entirely on it.
    await appendRows(['a', 'b', 'legacy-3', 'legacy-4', 'c', 'd'])

    const result = readAgentSessionHistory(journal, {
      sessionId: SESSION,
      direction: 'before',
      cursor: { epoch: journal.cursor().epoch, sequence: sequenceOf('c') },
      limit: 2
    })

    expect(result.ok).toBe(true)
    // The failure this guards is a page that is empty ONLY because of the filter while still
    // claiming older history: the reader re-asks from the same cursor forever.
    expect(result.page.items.map((item) => item.itemId)).toEqual([
      orcaItemKey('kept:a'),
      orcaItemKey('kept:b')
    ])
    expect(result.page.window.oldest).not.toBeNull()
    expect(result.page.hasOlder).toBe(false)
  })

  it('lets the renderer backfill loop terminate across a legacy run straddling a page boundary', async () => {
    await appendRows(['a', 'b', 'legacy-3', 'legacy-4', 'legacy-5', 'legacy-6', 'c', 'd', 'e', 'f'])

    const replay = backfillReplay(6, 2)

    expect(replay.requestedSequences.length).toBeLessThan(BACKFILL_REQUEST_BUDGET)
    expect(new Set(replay.requestedSequences).size).toBe(replay.requestedSequences.length)
    expect(replay.state.items.map((item) => item.itemId)).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => orcaItemKey(`kept:${name}`))
    )
    expect(replay.state.hasOlder).toBe(false)
  })
})

/** A wedged loop would run forever; the budget turns that into a finite, readable failure. */
const BACKFILL_REQUEST_BUDGET = 40

/**
 * A faithful replay of the renderer's initial backfill loop in
 * `structured-agent-session-read-owner.ts`: the same reducer, the same anchor cursor, and the same
 * single no-progress guard (`window.oldest` matching the anchor). `initialLimit` stands in for
 * `NATIVE_CHAT_INITIAL_LIMIT` so the journal stays small.
 */
function backfillReplay(
  initialLimit: number,
  tailLimit: number
): { state: StructuredAgentSessionState; requestedSequences: number[] } {
  const tail = readAgentSessionHistory(journal, {
    sessionId: SESSION,
    direction: 'tail',
    limit: tailLimit
  })
  expect(tail.ok).toBe(true)
  let state = reduceStructuredAgentSession(EMPTY_STRUCTURED_AGENT_SESSION, {
    type: 'tail-page',
    page: tail.page
  })
  const requestedSequences: number[] = []
  while (state.hasOlder && state.items.length < initialLimit) {
    if (requestedSequences.length >= BACKFILL_REQUEST_BUDGET) {
      break
    }
    const oldest: AgentJournalCursor | null = oldestStructuredAgentSessionCursor(state)
    if (!oldest) {
      break
    }
    requestedSequences.push(oldest.sequence)
    const older = readAgentSessionHistory(journal, {
      sessionId: SESSION,
      direction: 'before',
      cursor: oldest,
      limit: initialLimit - state.items.length
    })
    if (!older.ok || older.page.window.oldest?.sequence === oldest.sequence) {
      break
    }
    state = reduceStructuredAgentSession(state, {
      type: 'older-page',
      requestedCursor: oldest,
      page: older.page
    })
  }
  return { state, requestedSequences }
}
