import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import {
  readAgentSessionHistory,
  readAgentSessionHydrationPage
} from './agent-session-history-page'

const SESSION = 'session-restart-eviction-filter'
let root: string
let journal: AgentSessionJournal

async function appendStatus(clientMessageId: string, text: string): Promise<void> {
  await journal.appendItem(
    { provider: 'orca', clientMessageId },
    { kind: 'status', text },
    { fence: 8 }
  )
}

function orcaItemKey(clientMessageId: string): string {
  return agentJournalItemKey({ provider: 'orca', clientMessageId })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-restart-eviction-filter-'))
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

describe('restart-eviction status filtering', () => {
  it('hides a historical restart-eviction row while rendering a genuine provider exit', async () => {
    const hidden = `restart-eviction:${SESSION}:8`
    const rendered = [
      `provider-exit:${SESSION}:7:generation-1`,
      `restart-eviction:other-session:8`,
      `restart-eviction:${SESSION}:8:suffix`,
      `restart-eviction:${SESSION}:not-a-fence`
    ]
    await appendStatus(hidden, 'Provider exited: recorded pid absent on host')
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
})
