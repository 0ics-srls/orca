import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity,
  AgentSessionJournalIdentity
} from '../../../shared/agent-session-journal-types'
import Database from '../../sqlite/sync-database'
import { openJournalDatabase } from './journal-database'
import { JOURNAL_DB_SCHEMA_VERSION } from './journal-database-schema'
import { journalDatabaseFile } from './journal-paths'
import type { AgentSessionJournal } from './journal-store'
import { openAgentSessionJournal } from './journal-store-factory'

const IDENTITY: AgentSessionJournalIdentity = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  hostId: 'local',
  agent: 'codex',
  providerHandle: { kind: 'codex', threadId: 'thread-1' }
}

let root: string
let clock: number
let journals: AgentSessionJournal[]

function item(ordinal: number): AgentJournalItemIdentity {
  return { provider: 'codex', threadId: 'thread-1', turnId: 'turn-1', ordinal }
}

function body(text: string): AgentJournalItemBody {
  return { kind: 'status', text }
}

async function open(): Promise<AgentSessionJournal> {
  const journal = await openAgentSessionJournal({
    identity: IDENTITY,
    journalDir: root,
    now: () => ++clock,
    mintEpoch: () => `epoch-${clock}`
  })
  journals.push(journal)
  return journal
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-journal-epoch-migration-'))
  clock = 1_000
  journals = []
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.allSettled(journals.map((journal) => journal.close()))
  await rm(root, { recursive: true, force: true })
})

describe('journal epoch tombstone migration', () => {
  it('stores a no-match marker without advancing transcript state', async () => {
    const journal = await open()
    await journal.appendItem(item(0), body('keep'), { fence: 1 })
    const cursor = journal.cursor()
    const activity = journal.lastActivityAt()

    await expect(
      journal.applyEpochTombstoneMigration({
        migrationId: 'no-match-v1',
        settlementId: 'no-match-v1',
        fence: 1,
        selectIdentity: () => null
      })
    ).resolves.toEqual({ applied: true, tombstonedItems: 0 })

    expect(journal.cursor()).toEqual(cursor)
    expect(journal.lastActivityAt()).toBe(activity)
  })

  it('collects once across concurrent calls and skips collection after reopen', async () => {
    let journal = await open()
    await journal.appendItem(item(0), body('keep'), { fence: 1 })
    const selectIdentity = vi.fn(() => null)
    const input = {
      migrationId: 'concurrent-v1',
      settlementId: 'concurrent-v1',
      fence: 1,
      selectIdentity
    }

    const results = await Promise.all([
      journal.applyEpochTombstoneMigration(input),
      journal.applyEpochTombstoneMigration(input)
    ])

    expect(results).toEqual([
      { applied: true, tombstonedItems: 0 },
      { applied: false, tombstonedItems: 0 }
    ])
    expect(selectIdentity).toHaveBeenCalledOnce()
    await journal.close()
    journal = await open()
    const reopenedSelector = vi.fn(() => null)
    await expect(
      journal.applyEpochTombstoneMigration({ ...input, selectIdentity: reopenedSelector })
    ).resolves.toEqual({ applied: false, tombstonedItems: 0 })
    expect(reopenedSelector).not.toHaveBeenCalled()
  })

  it('commits neither marker nor tombstone when the marker insert fails', async () => {
    let journal = await open()
    const target = item(0)
    await journal.appendItem(target, body('remove'), { fence: 1 })
    const cursor = journal.cursor()
    const originalPrepare = Database.prototype.prepare
    vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
      this: Database.Database,
      sql: string
    ) {
      if (sql.startsWith('INSERT INTO journal_epoch_migrations')) {
        throw new Error('injected migration marker failure')
      }
      return originalPrepare.call(this, sql)
    })
    const input = {
      migrationId: 'rollback-v1',
      settlementId: 'rollback-v1',
      fence: 1,
      selectIdentity: () => target
    }

    await expect(journal.applyEpochTombstoneMigration(input)).rejects.toThrow(
      'injected migration marker failure'
    )
    expect(journal.cursor()).toEqual(cursor)
    expect(journal.snapshot().items).toHaveLength(1)
    vi.restoreAllMocks()
    await journal.close()
    journal = await open()
    expect(journal.cursor()).toEqual(cursor)
    expect(journal.snapshot().items).toHaveLength(1)

    await expect(journal.applyEpochTombstoneMigration(input)).resolves.toEqual({
      applied: true,
      tombstonedItems: 1
    })
    expect(journal.snapshot().items).toHaveLength(0)
  })

  it('runs the same migration once on a replacement epoch', async () => {
    const journal = await open()
    const firstSelector = vi.fn(() => null)
    await journal.applyEpochTombstoneMigration({
      migrationId: 'per-epoch-v1',
      settlementId: 'per-epoch-v1',
      fence: 1,
      selectIdentity: firstSelector
    })
    await journal.rollEpoch('corruption', 1)
    await journal.appendItem(item(0), body('new epoch'), { fence: 1 })
    const secondSelector = vi.fn(() => null)

    await expect(
      journal.applyEpochTombstoneMigration({
        migrationId: 'per-epoch-v1',
        settlementId: 'per-epoch-v1',
        fence: 1,
        selectIdentity: secondSelector
      })
    ).resolves.toEqual({ applied: true, tombstonedItems: 0 })
    expect(firstSelector).not.toHaveBeenCalled()
    expect(secondSelector).toHaveBeenCalledOnce()
  })

  it('does no migration SQL or collection against a future database schema', async () => {
    let journal = await open()
    await journal.appendItem(item(0), body('keep'), { fence: 1 })
    await journal.close()
    const seeded = openJournalDatabase(journalDatabaseFile(root))
    seeded.db.pragma(`user_version = ${JOURNAL_DB_SCHEMA_VERSION + 1}`)
    seeded.db.close()
    journal = await open()
    const selectIdentity = vi.fn(() => item(0))

    await expect(
      journal.applyEpochTombstoneMigration({
        migrationId: 'future-db-v1',
        settlementId: 'future-db-v1',
        fence: 1,
        selectIdentity
      })
    ).resolves.toEqual({ applied: false, tombstonedItems: 0 })
    expect(selectIdentity).not.toHaveBeenCalled()
    await journal.close()
    const inspected = openJournalDatabase(journalDatabaseFile(root))
    try {
      expect(inspected.db.pragma('user_version', { simple: true })).toBe(
        JOURNAL_DB_SCHEMA_VERSION + 1
      )
      expect(
        inspected.db.prepare('SELECT count(*) AS total FROM journal_rows').get()
      ).toMatchObject({
        total: 2
      })
      expect(
        inspected.db.prepare('SELECT count(*) AS total FROM journal_epoch_migrations').get()
      ).toMatchObject({ total: 0 })
    } finally {
      inspected.db.close()
    }
  })
})
