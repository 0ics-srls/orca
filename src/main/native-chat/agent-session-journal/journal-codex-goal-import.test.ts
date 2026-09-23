import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexJournalGoals } from '../../codex/codex-structured-journal-goals'
import { parseCodexGoalJournalItemId } from '../../codex/codex-goal-journal-identity'
import { createDeferredStructuredAgentSessionEventSink } from '../agent-session-wire/structured-agent-session-event-sink'
import { readNativeChatTranscript } from '../transcript-reader'
import {
  appendLegacyTranscriptMessages,
  importLegacyTranscriptIntoJournal
} from './journal-legacy-import'
import { openAgentSessionJournal } from './journal-store-factory'
import type { AgentSessionJournal } from './journal-store'

const THREAD = '00000000-0000-4000-8000-000000000001'
const fixture = await readFile(
  new URL('../fixtures/codex-0.155.1-goal.jsonl', import.meta.url),
  'utf8'
)
const roots: string[] = []
const journals: AgentSessionJournal[] = []
afterEach(async () => {
  await Promise.all(journals.splice(0).map((journal) => journal.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('adopts goal history under live identities and deduplicates resumed snapshots after reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-goal-journal-'))
  roots.push(root)
  const filePath = join(root, 'rollout.jsonl')
  await writeFile(filePath, fixture)
  const options = {
    journalDir: join(root, 'journal'),
    identity: {
      sessionId: 'session',
      workspaceId: 'folder:fixture',
      hostId: 'host',
      agent: 'codex' as const,
      providerHandle: { kind: 'codex' as const, threadId: THREAD }
    }
  }
  let journal = await openAgentSessionJournal(options)
  journals.push(journal)
  const imported = await importLegacyTranscriptIntoJournal({
    journal,
    agent: 'codex',
    sessionId: THREAD,
    fence: 1,
    options: { filePath }
  })
  expect(imported).toMatchObject({ ok: true, imported: 2 })
  const initial = journal.snapshot().items
  expect(initial.filter((item) => parseCodexGoalJournalItemId(item.itemId))).toHaveLength(1)
  await journal.close()
  journals.pop()
  journal = await openAgentSessionJournal(options)
  journals.push(journal)
  const sink = createDeferredStructuredAgentSessionEventSink()
  sink.bind({ journal, fence: 1, publish: () => {} })
  const goals = new CodexJournalGoals(sink.sink)
  const update = async (status: string, tokensUsed: number) => {
    goals.handle({
      threadId: THREAD,
      method: 'thread/goal/updated',
      params: {
        threadId: THREAD,
        goal: {
          threadId: THREAD,
          objective: 'Keep the scratch folder tidy.',
          status,
          tokensUsed,
          createdAt: 1790073005
        }
      }
    })
    expect(await sink.drained()).toEqual({ ok: true })
  }
  await update('active', 10)
  expect(journal.snapshot().items).toEqual(initial)
  await update('paused', 15)
  await update('active', 20)
  await update('active', 30)
  expect(
    journal.snapshot().items.filter((item) => parseCodexGoalJournalItemId(item.itemId))
  ).toHaveLength(3)
  const decoded = await readNativeChatTranscript('codex', THREAD, { filePath })
  if (!('messages' in decoded)) {
    throw new Error(decoded.error)
  }
  const visits = vi.spyOn(journal, 'visitItems')
  await appendLegacyTranscriptMessages({
    journal,
    agent: 'codex',
    sessionId: THREAD,
    fence: 1,
    messages: decoded.messages.filter((message) => message.codexGoal)
  })
  expect(
    journal.snapshot().items.filter((item) => parseCodexGoalJournalItemId(item.itemId))
  ).toHaveLength(3)
  expect(visits).not.toHaveBeenCalled()
  visits.mockRestore()
  goals.dispose()
  sink.close()
})
