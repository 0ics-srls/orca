import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../../shared/agent-session-journal-types'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { createTrackedJournalOpener } from '../agent-session-journal/journal-store-test-open'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { performThreadGoalChange } from './structured-agent-session-thread-goal'
import type { AgentSessionTurnContext } from './structured-agent-session-turns'

const IDENTITY: AgentSessionJournalIdentity = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  hostId: 'host-1',
  agent: 'codex',
  providerHandle: { kind: 'codex', threadId: 'thread-1' }
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

async function openJournal(): Promise<AgentSessionJournal> {
  root ??= await mkdtemp(join(tmpdir(), 'orca-thread-goal-'))
  return journals.open({ identity: IDENTITY, journalDir: root })
}

function context(
  journal: AgentSessionJournal,
  adapter: Partial<StructuredAgentSessionAdapter>
): AgentSessionTurnContext {
  return {
    sessionId: 'session-1',
    journal,
    fence: 1,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the goal path reads only the goal methods.
    adapter: adapter as StructuredAgentSessionAdapter,
    persistOptions: async () => undefined,
    resolvedBy: 'client-1',
    publish: vi.fn(),
    flushStreamedEvents: async () => undefined,
    now: () => 1
  }
}

describe('performThreadGoalChange', () => {
  it('journals the objective as a user message sent as a goal, durably', async () => {
    const journal = await openJournal()
    const changeThreadGoal = vi.fn(async () => ({ ok: true as const }))

    const result = await performThreadGoalChange(
      context(journal, { changeThreadGoal, supportsThreadGoal: () => true }),
      { clientOperationId: 'op-1', change: { kind: 'set', objective: 'Ship the parser' } }
    )

    expect(result).toEqual({ ok: true, value: { change: 'set' } })
    expect(changeThreadGoal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      fence: 1,
      change: { kind: 'set', objective: 'Ship the parser' }
    })
    const expected = {
      kind: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: 'Ship the parser' }],
      sentAs: 'goal'
    }
    expect(journal.snapshot().items.map((item) => item.body)).toEqual([expected])

    // The marker must survive a reopen: the persisted row validator admits it.
    await journal.close()
    const reopened = await openJournal()
    expect(reopened.snapshot().items.map((item) => item.body)).toEqual([expected])
  })

  it('removes the objective when the provider refuses the goal', async () => {
    const journal = await openJournal()
    const ctx = context(journal, {
      changeThreadGoal: async () => ({ ok: false, rejected: 'goals feature is disabled' }),
      supportsThreadGoal: () => true
    })

    const result = await performThreadGoalChange(ctx, {
      clientOperationId: 'op-2',
      change: { kind: 'set', objective: 'Ship the parser' }
    })

    expect(result).toEqual({
      ok: false,
      refusal: { code: 'agent_session_operation_invalid', message: 'goals feature is disabled' }
    })
    expect(journal.snapshot().items).toEqual([])
  })

  it('removes the objective when the provider request fails outright', async () => {
    const journal = await openJournal()
    const ctx = context(journal, {
      changeThreadGoal: async () => {
        throw new Error('connection closed')
      },
      supportsThreadGoal: () => true
    })

    await expect(
      performThreadGoalChange(ctx, {
        clientOperationId: 'op-3',
        change: { kind: 'set', objective: 'Ship the parser' }
      })
    ).rejects.toThrow('connection closed')
    expect(journal.snapshot().items).toEqual([])
  })

  it('journals nothing for a status change or clear', async () => {
    const journal = await openJournal()
    const changeThreadGoal = vi.fn(async () => ({ ok: true as const }))
    const ctx = context(journal, { changeThreadGoal, supportsThreadGoal: () => true })

    await performThreadGoalChange(ctx, {
      clientOperationId: 'op-3',
      change: { kind: 'status', status: 'paused' }
    })
    await performThreadGoalChange(ctx, { clientOperationId: 'op-4', change: { kind: 'clear' } })

    expect(changeThreadGoal).toHaveBeenCalledTimes(2)
    expect(journal.snapshot().items).toEqual([])
  })

  it('refuses a session whose provider has no goals, without touching the journal', async () => {
    const journal = await openJournal()
    const changeThreadGoal = vi.fn(async () => ({ ok: true as const }))

    const result = await performThreadGoalChange(
      context(journal, { changeThreadGoal, supportsThreadGoal: () => false }),
      { clientOperationId: 'op-5', change: { kind: 'set', objective: 'Ship it' } }
    )

    expect(result).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_invalid' }
    })
    expect(changeThreadGoal).not.toHaveBeenCalled()
    expect(journal.snapshot().items).toEqual([])
  })

  it('reports the latest goal the whole journal records', async () => {
    const journal = await openJournal()
    const goal = {
      objective: 'Ship the parser',
      status: 'paused' as const,
      tokenBudget: null,
      tokensUsed: 1,
      timeUsedSeconds: 2,
      createdAt: 3_000,
      updatedAt: 4_000
    }
    expect(journal.threadGoal()).toBeNull()
    await journal.appendItem(
      { provider: 'orca', clientMessageId: 'goal-row' },
      { kind: 'status', text: 'Goal paused', threadGoal: { state: 'set', goal } },
      { fence: 1 }
    )
    expect(journal.threadGoal()).toEqual(goal)
  })
})
