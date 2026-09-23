import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import { currentAgentSessionThreadGoal } from '../../shared/agent-session-thread-goal'
import type { AgentSessionJournal } from '../native-chat/agent-session-journal/journal-store'
import { createTrackedJournalOpener } from '../native-chat/agent-session-journal/journal-store-test-open'
import { readAgentSessionHistory } from '../native-chat/agent-session-wire/agent-session-history-page'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { CodexJournalGoals } from './codex-structured-journal-goals'

const THREAD = '01a08cc2-f96e-76d0-bb74-88b9bc0b03fc'
const IDENTITY: AgentSessionJournalIdentity = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  hostId: 'host-1',
  agent: 'codex',
  providerHandle: { kind: 'codex', threadId: THREAD }
}

let root: string | null = null
const journals = createTrackedJournalOpener()

afterEach(async () => {
  await journals.closeAll()
  if (root) {
    await rm(root, { recursive: true, force: true })
    root = null
  }
})

function goalFrame(goal: Record<string, unknown> = {}) {
  return {
    threadId: THREAD,
    turnId: null,
    goal: {
      threadId: THREAD,
      objective: 'Ship the parser',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1789067988,
      updatedAt: 1789067988,
      ...goal
    }
  }
}

/** Drives the real journal through the lifecycle-transition path the host sink provides. */
function journalSink(journal: AgentSessionJournal) {
  const writes: Promise<unknown>[] = []
  const sink: StructuredAgentSessionEventSink = {
    appendItem: vi.fn(),
    appendTombstone: vi.fn(),
    publish: vi.fn(),
    journalEpoch: () => journal.epoch,
    tryAppendLifecycleTransition: (_bound, body, resolveIdentity) => {
      const identity = resolveIdentity(journal)
      if (identity) {
        writes.push(journal.appendItem(identity, body, { fence: 1 }))
      }
      return { accepted: true }
    }
  }
  return { sink, drained: () => Promise.all(writes.splice(0)) }
}

describe('codex goal accounting revisions', () => {
  it('revises the goal row in place: one visible row, pinned sequence, fresh counters', async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-goal-revision-'))
    const journal = await journals.open({ identity: IDENTITY, journalDir: root })
    await journal.appendItem(
      { provider: 'orca', clientMessageId: 'earlier' },
      { kind: 'status', text: 'Context compacted' },
      { fence: 1 }
    )
    const { sink, drained } = journalSink(journal)
    const goals = new CodexJournalGoals(sink)

    goals.handle({ threadId: THREAD, method: 'thread/goal/updated', params: goalFrame() })
    await drained()
    const [, created] = journal.snapshot().items
    await journal.appendItem(
      { provider: 'orca', clientMessageId: 'later' },
      { kind: 'status', text: 'Something after the goal' },
      { fence: 1 }
    )

    // A tick inside the revision interval is not worth a persisted row.
    goals.handle({
      threadId: THREAD,
      method: 'thread/goal/updated',
      params: goalFrame({ timeUsedSeconds: 10, updatedAt: 1789067998 })
    })
    await drained()
    expect(journal.snapshot().items[1]?.revision).toBe(created?.revision)

    const subscriberCursor = journal.cursor()
    goals.handle({
      threadId: THREAD,
      method: 'thread/goal/updated',
      params: goalFrame({ tokensUsed: 900, timeUsedSeconds: 45, updatedAt: 1789068033 })
    })
    await drained()

    const items = journal.snapshot().items
    expect(items.map((item) => item.itemId)).toEqual([
      'orca:earlier',
      created?.itemId,
      'orca:later'
    ])
    const revised = items[1]
    expect(revised?.sequence).toBe(created?.sequence)
    expect(revised?.revision).toBe((created?.revision ?? 0) + 1)
    expect(currentAgentSessionThreadGoal(items)).toMatchObject({
      tokensUsed: 900,
      timeUsedSeconds: 45,
      updatedAt: 1789068033_000
    })
    // The live page a caught-up subscriber is sent after the write carries the
    // revised row under its original sequence, not a second goal row.
    const page = readAgentSessionHistory(journal, {
      sessionId: IDENTITY.sessionId,
      direction: 'after',
      cursor: subscriberCursor
    })
    expect(page.ok && page.page.items).toEqual([
      expect.objectContaining({
        itemId: created?.itemId,
        sequence: created?.sequence,
        revision: (created?.revision ?? 0) + 1
      })
    ])
    expect(page.ok && page.page.removedItemIds).toEqual([])
    goals.dispose()
  })

  it('refreshes the row from a resume snapshot of the same goal', async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-goal-resume-revision-'))
    const journal = await journals.open({ identity: IDENTITY, journalDir: root })
    const first = journalSink(journal)
    const prior = new CodexJournalGoals(first.sink)
    prior.handle({ threadId: THREAD, method: 'thread/goal/updated', params: goalFrame() })
    await first.drained()
    prior.dispose()
    const [created] = journal.snapshot().items

    const second = journalSink(journal)
    const resumed = new CodexJournalGoals(second.sink)
    // Only a few seconds more: a resume snapshot still refreshes, since no live tick follows.
    const snapshot = goalFrame({ timeUsedSeconds: 3, updatedAt: 1789067991 })
    resumed.handle({ threadId: THREAD, method: 'thread/goal/updated', params: snapshot })
    await second.drained()
    resumed.handle({ threadId: THREAD, method: 'thread/goal/updated', params: snapshot })
    await second.drained()

    const items = journal.snapshot().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      itemId: created?.itemId,
      sequence: created?.sequence,
      revision: (created?.revision ?? 0) + 1
    })
    expect(currentAgentSessionThreadGoal(items)?.timeUsedSeconds).toBe(3)
    resumed.dispose()
  })
})
