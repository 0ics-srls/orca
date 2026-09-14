import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity,
  AgentSessionJournalIdentity
} from '../../../shared/agent-session-journal-types'
import { serializeRemoteRuntimePayload } from '../../../shared/remote-runtime-memory-limits'
import { MAX_RETAINED_SUBMISSIONS } from '../../../shared/structured-agent-session-submission-retention'
import { createTrackedJournalOpener } from '../agent-session-journal/journal-store-test-open'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { AGENT_SESSION_HISTORY_MAX_PAGE_BYTES } from './agent-session-history-page-bounds'
import {
  readAgentSessionHistory,
  readAgentSessionHydrationPage
} from './agent-session-history-page'

const IDENTITY: AgentSessionJournalIdentity = {
  sessionId: 'session-1',
  workspaceId: 'ws-1',
  hostId: 'host-1',
  agent: 'codex',
  providerHandle: { kind: 'codex', threadId: 'thread-1' }
}

/** Enough items that the byte bound, not the count limit, is what ends the page. */
const PAGE_LIMIT = 40
const ITEM_BODY_BYTES = 60 * 1024

const journals = createTrackedJournalOpener()
let root: string
let clock = 1_000
let journal: AgentSessionJournal

function tick(): number {
  clock += 1
  return clock
}

function item(ordinal: number): AgentJournalItemIdentity {
  return { provider: 'codex', threadId: 'thread-1', turnId: 'turn-1', ordinal }
}

function body(text: string): AgentJournalItemBody {
  return { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }
}

function serializedPageBytes(value: unknown): number {
  return Buffer.byteLength(serializeRemoteRuntimePayload(value), 'utf8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-wire-budget-'))
  clock = 1_000
  journal = await journals.open({ identity: IDENTITY, journalDir: root, now: tick })
})

afterEach(async () => {
  await journals.closeAll()
  await rm(root, { recursive: true, force: true })
})

/** A full retained window whose own items are all off-page, so every one of its records
 *  rides on the page without any item accounting for it. */
async function seedOffPageRetainedWindow(): Promise<void> {
  const reason = 'x'.repeat(16 * 1024)
  for (let index = 0; index < MAX_RETAINED_SUBMISSIONS; index += 1) {
    await journal.appendSubmission({
      clientMessageId: `msg-${index}`,
      payloadFingerprint: 'e'.repeat(64),
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'hi' }] },
      fence: 1
    })
    await journal.resolveDispatch({
      clientMessageId: `msg-${index}`,
      state: 'rejected',
      reason,
      fence: 1
    })
  }
  for (let ordinal = 1; ordinal <= PAGE_LIMIT; ordinal += 1) {
    await journal.appendItem(item(ordinal), body('b'.repeat(ITEM_BODY_BYTES)), { fence: 1 })
  }
}

describe('history page byte budget', () => {
  // The retained window rides on every replacing page but is priced against items that
  // are not on it, so items must be trimmed to leave room for it. Asserting against the
  // 4 MiB channel cap would not see this: without the reservation the page is 2.3 MB,
  // over its own 2 MiB cap and still well under the channel's, so the transport gate
  // never throws and the overflow is silent.
  it('leaves room for the retained window when items alone would fill the page', async () => {
    await seedOffPageRetainedWindow()

    const page = readAgentSessionHistory(journal, {
      sessionId: IDENTITY.sessionId,
      direction: 'tail',
      limit: PAGE_LIMIT
    })
    if (!page.ok) {
      throw new Error(`expected a page, got reset ${page.reset}`)
    }
    // Items were dropped for bytes, not for the count limit: without this the assertion
    // below would hold for a fixture that never filled the budget at all.
    expect(page.page.items.length).toBeLessThan(PAGE_LIMIT)
    expect(page.page.hasOlder).toBe(true)
    expect(page.page.submissions).toHaveLength(MAX_RETAINED_SUBMISSIONS)
    expect(serializedPageBytes(page.page)).toBeLessThanOrEqual(AGENT_SESSION_HISTORY_MAX_PAGE_BYTES)
  })

  // The same reservation, reached through the other call site.
  it('leaves room for the retained window on a hydration page', async () => {
    await seedOffPageRetainedWindow()

    const page = readAgentSessionHydrationPage(journal)
    expect(page.items.length).toBeLessThan(PAGE_LIMIT)
    expect(page.submissions).toHaveLength(MAX_RETAINED_SUBMISSIONS)
    expect(serializedPageBytes(page)).toBeLessThanOrEqual(AGENT_SESSION_HISTORY_MAX_PAGE_BYTES)
  })
})
