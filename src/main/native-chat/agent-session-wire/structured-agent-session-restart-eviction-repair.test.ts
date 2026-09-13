import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import { openJournalDatabase } from '../agent-session-journal/journal-database'
import { journalDatabaseFile } from '../agent-session-journal/journal-paths'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import {
  RESTART_EVICTION_STATUS_MIGRATION_ID,
  repairSyntheticRestartEvictionSettlements
} from './structured-agent-session-restart-eviction-repair'

const SESSION = 'session-repair'
let root: string
let journal: AgentSessionJournal

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-restart-eviction-repair-'))
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

describe('synthetic restart-eviction journal repair', () => {
  it('tombstones only exact Orca-owned identities and is idempotent', async () => {
    const exact = `restart-eviction:${SESSION}:8`
    const retained = [
      `restart-eviction:other-session:8`,
      `restart-eviction:${SESSION}:8:suffix`,
      `provider-exit:${SESSION}:7:generation-1`
    ]
    await journal.appendItem(
      { provider: 'orca', clientMessageId: exact },
      { kind: 'status', text: 'old synthetic row' },
      { fence: 8 }
    )
    for (const clientMessageId of retained) {
      await journal.appendItem(
        { provider: 'orca', clientMessageId },
        { kind: 'status', text: `keep ${clientMessageId}` },
        { fence: 8 }
      )
    }

    await expect(
      repairSyntheticRestartEvictionSettlements({ journal, sessionId: SESSION, fence: 8 })
    ).resolves.toBe(1)
    const repairedCursor = journal.cursor()
    await journal.close()
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
    await expect(
      repairSyntheticRestartEvictionSettlements({ journal, sessionId: SESSION, fence: 8 })
    ).resolves.toBe(0)

    expect(journal.cursor()).toEqual(repairedCursor)
    const itemIds = journal.snapshot().items.map((item) => item.itemId)
    expect(itemIds).not.toContain(agentJournalItemKey({ provider: 'orca', clientMessageId: exact }))
    for (const clientMessageId of retained) {
      expect(itemIds).toContain(agentJournalItemKey({ provider: 'orca', clientMessageId }))
    }
    const database = openJournalDatabase(journalDatabaseFile(root))
    try {
      expect(
        database.db
          .prepare(
            `SELECT count(*) AS total FROM journal_epoch_migrations
             WHERE session_id = ? AND epoch = ? AND migration_id = ?`
          )
          .get(SESSION, journal.epoch, RESTART_EVICTION_STATUS_MIGRATION_ID)
      ).toMatchObject({ total: 1 })
    } finally {
      database.db.close()
    }
  })
})
