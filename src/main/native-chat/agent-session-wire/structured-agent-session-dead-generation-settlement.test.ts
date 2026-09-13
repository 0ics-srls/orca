import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import {
  settleStructuredAgentSessionDeadGeneration,
  UNEXPECTED_PROVIDER_EXIT_OUTCOME
} from './structured-agent-session-dead-generation-settlement'

const SESSION = 'session-dead-generation'
const THREAD = 'thread-1'
let root: string
let journal: AgentSessionJournal

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-dead-generation-'))
  journal = await openAgentSessionJournal({
    identity: {
      sessionId: SESSION,
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'codex',
      providerHandle: { kind: 'codex', threadId: THREAD }
    },
    journalDir: root,
    now: () => 1_000
  })
})

afterEach(async () => {
  await journal.close()
  await rm(root, { recursive: true, force: true })
})

async function seedUnfinishedWork(): Promise<void> {
  await journal.appendSubmission({
    clientMessageId: 'client-1',
    payloadFingerprint: 'fingerprint',
    body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'keep going' }] },
    fence: 7
  })
  await journal.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'turn-1', ordinal: 1 },
    { kind: 'tool-call', name: 'shell', input: { command: 'pnpm test' }, state: 'running' },
    { fence: 7 }
  )
  await journal.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'turn-1', ordinal: 2 },
    {
      kind: 'approval',
      title: 'Run command?',
      detail: null,
      options: [{ id: 'yes', label: 'Allow' }],
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    },
    { fence: 7 }
  )
  await journal.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'turn-1', ordinal: 3 },
    {
      kind: 'question',
      question: 'Which target?',
      options: [{ id: 'web', label: 'Web' }],
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    },
    { fence: 7 }
  )
  await journal.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'turn-1', ordinal: 4 },
    { kind: 'turn', turnId: 'turn-1', state: 'running', startedAt: 900 },
    { fence: 7 }
  )
}

describe('dead structured-session generation settlement', () => {
  it('settles probe-proven work as unverifiable without a technical chat row or fake end time', async () => {
    await seedUnfinishedWork()

    await expect(
      settleStructuredAgentSessionDeadGeneration({
        journal,
        sessionId: SESSION,
        fence: 8,
        settlementId: `restart-eviction:${SESSION}:8`,
        pendingSubmissionReason: 'provider_exited_before_acknowledgement',
        verdict: { state: 'unverifiable' },
        showUnexpectedExitOutcome: false
      })
    ).resolves.toBe(true)

    const snapshot = journal.snapshot()
    expect(snapshot.submissions).toEqual([
      expect.objectContaining({ clientMessageId: 'client-1', dispatchState: 'unknown' })
    ])
    expect(snapshot.items.map((item) => item.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'tool-call', state: 'failed' }),
        expect.objectContaining({
          kind: 'approval',
          resolution: expect.objectContaining({ state: 'cancelled' })
        }),
        expect.objectContaining({
          kind: 'question',
          resolution: expect.objectContaining({ state: 'cancelled' })
        }),
        { kind: 'turn', turnId: 'turn-1', state: 'unverifiable', startedAt: 900 }
      ])
    )
    expect(snapshot.items.some((item) => item.body.kind === 'status')).toBe(false)
  })

  it('adds one actionable outcome for observed active-work failure and is idempotent', async () => {
    await seedUnfinishedWork()
    const input = {
      journal,
      sessionId: SESSION,
      fence: 7,
      settlementId: `provider-exit:${SESSION}:7:generation-1`,
      pendingSubmissionReason: 'provider_exited_before_acknowledgement',
      verdict: { state: 'interrupted' as const, completedAt: 1_000 },
      showUnexpectedExitOutcome: true
    }

    await expect(settleStructuredAgentSessionDeadGeneration(input)).resolves.toBe(true)
    const settledCursor = journal.cursor()
    await expect(settleStructuredAgentSessionDeadGeneration(input)).resolves.toBe(true)

    expect(journal.cursor()).toEqual(settledCursor)
    expect(
      journal
        .snapshot()
        .items.filter(
          (item) =>
            item.body.kind === 'status' && item.body.text === UNEXPECTED_PROVIDER_EXIT_OUTCOME
        )
    ).toHaveLength(1)
  })

  it('retries an already settled expected close without writing through a closed journal gate', async () => {
    const settledItem: AgentJournalRenderItem = {
      itemId: 'codex:thread-1:turn-1:0',
      revision: 2,
      sequence: 2,
      observedAt: 1_000,
      body: {
        kind: 'turn',
        turnId: 'turn-1',
        state: 'interrupted',
        completedAt: 1_000
      }
    }
    const settledSnapshot = journal.snapshot()
    const closedJournal: Pick<
      AgentSessionJournal,
      'snapshot' | 'submissions' | 'markPendingSubmissionsUnknown' | 'appendLifecycleBatch'
    > = {
      snapshot: () => ({
        ...settledSnapshot,
        items: [settledItem]
      }),
      submissions: () => [],
      markPendingSubmissionsUnknown: async () => {
        throw new Error('journal_closed')
      },
      appendLifecycleBatch: async () => {
        throw new Error('journal_closed')
      }
    }

    await expect(
      settleStructuredAgentSessionDeadGeneration({
        journal: closedJournal,
        sessionId: SESSION,
        fence: 7,
        settlementId: `expected-close:${SESSION}:7:generation-1`,
        pendingSubmissionReason: 'provider_closed_before_acknowledgement',
        verdict: { state: 'interrupted', completedAt: 1_000 },
        showUnexpectedExitOutcome: false
      })
    ).resolves.toBe(true)
  })

  it('settles a live unknown submission even when no unfinished item remains', async () => {
    await journal.appendSubmission({
      clientMessageId: 'client-unknown',
      payloadFingerprint: 'fingerprint',
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'did this land?' }] },
      fence: 7
    })
    await journal.resolveDispatch({
      clientMessageId: 'client-unknown',
      state: 'unknown',
      reason: 'provider write outcome unknown',
      fence: 7
    })

    await expect(
      settleStructuredAgentSessionDeadGeneration({
        journal,
        sessionId: SESSION,
        fence: 7,
        settlementId: `expected-close:${SESSION}:7:generation-1`,
        pendingSubmissionReason: 'provider_closed_before_acknowledgement',
        verdict: { state: 'interrupted', completedAt: 1_000 },
        showUnexpectedExitOutcome: false
      })
    ).resolves.toBe(true)

    expect(journal.submissions()).toEqual([
      expect.objectContaining({
        clientMessageId: 'client-unknown',
        dispatchState: 'unknown',
        recovered: true,
        reason: 'provider write outcome unknown'
      })
    ])
  })
})
