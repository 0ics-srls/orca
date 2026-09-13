// Read restore decides whether a session comes back at all.
//
// A chat still in the pre-SQLite format has no `journal.db`, so the probe that
// loads one reports nothing. Reading that as "no session" is what removed these
// chats: an unpublished session is also what prunes its tab out of the saved
// workspace, so the tab is gone before anything can explain itself.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { openJournalDatabase } from '../agent-session-journal/journal-database'
import { journalDatabaseFile, journalDirectoryFor } from '../agent-session-journal/journal-paths'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import { readAgentSessionHistory } from './agent-session-history-page'
import { restoreStructuredAgentSessionRead } from './structured-agent-session-read-restore'

const SESSION_ID = 'codex_read_restore_fixture'
const WORKSPACE_ID = 'repo-1::/tmp/workspace'

const RECORD = {
  schemaVersion: 2,
  sessionId: SESSION_ID,
  location: {
    executionHostId: 'local',
    wslDistro: null,
    workspaceId: WORKSPACE_ID,
    workspaceKind: 'git-worktree'
  },
  provider: 'codex',
  providerHandleChain: [
    {
      linkId: 'codex-1-thread-1',
      handle: { provider: 'codex', threadId: 'thread-1' },
      origin: 'created',
      mintedAtFence: 1,
      observedAt: 1
    }
  ],
  accountHome: { variable: 'CODEX_HOME', path: '/tmp/codex-home' },
  createdAt: 1,
  updatedAt: 2,
  lease: { sessionId: SESSION_ID, runtimeKind: 'native', runtimeFence: 1 }
} as unknown as AgentSessionRecord

const store = {
  getRecord: (sessionId: string) => (sessionId === SESSION_ID ? RECORD : null)
} as unknown as AgentSessionRecordStore

let journalRoot: string
const opened: AgentSessionJournal[] = []

async function writeRemnant(name: string): Promise<string> {
  const dir = journalDirectoryFor(journalRoot, {
    workspaceId: WORKSPACE_ID,
    sessionId: SESSION_ID
  })
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), '{"kind":"epoch","v":1,"seq":1}\n', 'utf8')
  return join(dir, name)
}

beforeEach(async () => {
  journalRoot = await mkdtemp(join(tmpdir(), 'orca-read-restore-'))
})

afterEach(async () => {
  await Promise.allSettled(opened.splice(0).map((journal) => journal.close()))
  await rm(journalRoot, { recursive: true, force: true })
})

describe('a session whose journal is still the pre-SQLite format', () => {
  it('is published, carrying the message that explains it', async () => {
    const transcript = await writeRemnant('log.jsonl')

    const restored = await restoreStructuredAgentSessionRead(store, journalRoot, SESSION_ID)

    expect(restored).not.toBeNull()
    opened.push(restored!.journal)
    const disclosed = restored!.journal
      .snapshot()
      .items.map((entry) => (entry.body.kind === 'status' ? entry.body.text : ''))
    expect(disclosed.join('')).toContain(transcript)
    // Publishing it costs no agent process; acquisition still waits for the user.
    expect(restored!.hasProviderChild).toBe(false)
  })

  it('is published for a remnant whose log is gone', async () => {
    await writeRemnant('snapshot.json')

    const restored = await restoreStructuredAgentSessionRead(store, journalRoot, SESSION_ID)

    expect(restored).not.toBeNull()
    opened.push(restored!.journal)
  })

  it('still drops a session with neither a journal nor a remnant', async () => {
    const restored = await restoreStructuredAgentSessionRead(store, journalRoot, SESSION_ID)

    expect(restored).toBeNull()
  })

  it('still drops a session with no record', async () => {
    await writeRemnant('log.jsonl')

    const restored = await restoreStructuredAgentSessionRead(store, journalRoot, 'unknown-session')

    expect(restored).toBeNull()
  })
})

describe('a journal from a newer row schema', () => {
  it('restores read-only history without attempting the restart-eviction migration', async () => {
    const journalDir = journalDirectoryFor(journalRoot, {
      workspaceId: WORKSPACE_ID,
      sessionId: SESSION_ID
    })
    const legacyIdentity = {
      provider: 'orca' as const,
      clientMessageId: `restart-eviction:${SESSION_ID}:1`
    }
    const seeded = await openAgentSessionJournal({
      identity: {
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        hostId: 'local',
        agent: 'codex',
        providerHandle: { kind: 'codex', threadId: 'thread-1' }
      },
      journalDir
    })
    await seeded.appendItem(
      legacyIdentity,
      { kind: 'status', text: 'legacy restart eviction status' },
      { fence: 1 }
    )
    const epoch = seeded.epoch
    const futureSequence = seeded.cursor().sequence + 1
    await seeded.close()
    const database = openJournalDatabase(journalDatabaseFile(journalDir))
    try {
      database.db
        .prepare(
          'INSERT INTO journal_rows (session_id, epoch, seq, ts, row_json) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          SESSION_ID,
          epoch,
          futureSequence,
          3,
          JSON.stringify({
            v: 99,
            kind: 'item',
            epoch,
            seq: futureSequence,
            fence: 1,
            ts: 3,
            itemId: 'future',
            revision: 1,
            body: { kind: 'status', text: 'future row' }
          })
        )
    } finally {
      database.db.close()
    }

    const restored = await restoreStructuredAgentSessionRead(store, journalRoot, SESSION_ID)

    expect(restored).not.toBeNull()
    opened.push(restored!.journal)
    expect(restored!.journal.isReadOnly).toBe(true)
    expect(restored!.journal.snapshot().items.map((item) => item.itemId)).toContain(
      agentJournalItemKey(legacyIdentity)
    )
    expect(
      readAgentSessionHistory(restored!.journal, { sessionId: SESSION_ID, direction: 'tail' })
    ).toMatchObject({
      ok: false,
      reset: 'schema_unreadable'
    })
    const inspected = openJournalDatabase(journalDatabaseFile(journalDir))
    try {
      expect(
        inspected.db.prepare('SELECT count(*) AS total FROM journal_rows').get()
      ).toMatchObject({ total: 3 })
      expect(
        inspected.db.prepare('SELECT count(*) AS total FROM journal_epoch_migrations').get()
      ).toMatchObject({ total: 0 })
    } finally {
      inspected.db.close()
    }
  })
})
