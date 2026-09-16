import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemIdentity,
  AgentJournalMessageItem,
  AgentSessionJournalIdentity
} from '../../../shared/agent-session-journal-types'
import type { JournalLifecycleBatchInput } from './journal-store-contracts'
import type { AgentSessionJournal } from './journal-store'
import { createTrackedJournalOpener } from './journal-store-test-open'

const IDENTITY: AgentSessionJournalIdentity = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  hostId: 'host-1',
  agent: 'codex',
  providerHandle: { kind: 'codex', threadId: 'thread-1' }
}

const journals = createTrackedJournalOpener()
let root: string
let clock = 1_000

function tick(): number {
  clock += 1
  return clock
}

function turnIdentity(turnId: string): AgentJournalItemIdentity {
  return {
    provider: 'legacy',
    agent: 'codex',
    sessionId: IDENTITY.sessionId,
    recordId: `turn-lifecycle:${turnId}`
  }
}

function claudeTurnIdentity(turnId: string): AgentJournalItemIdentity {
  return {
    provider: 'legacy',
    agent: 'claude',
    sessionId: IDENTITY.sessionId,
    recordId: `turn-lifecycle:${turnId}`
  }
}

function userMessage(text: string): AgentJournalMessageItem {
  return { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }
}

function terminalTurn(
  turnId: string,
  state: 'completed' | 'interrupted',
  settlementId = `${state}:${turnId}`
): JournalLifecycleBatchInput {
  return {
    settlementId,
    fence: 1,
    mutations: [
      {
        kind: 'item',
        identity: turnIdentity(turnId),
        body: { kind: 'turn', turnId, state }
      }
    ]
  }
}

async function open(): Promise<AgentSessionJournal> {
  return journals.open({
    identity: IDENTITY,
    journalDir: root,
    now: tick,
    mintEpoch: () => `epoch-${clock}`
  })
}

async function appendPending(
  journal: AgentSessionJournal,
  clientMessageId: string,
  fence = 1
): Promise<void> {
  await journal.appendSubmission({
    clientMessageId,
    payloadFingerprint: `fingerprint:${clientMessageId}`,
    body: userMessage(clientMessageId),
    fence
  })
}

async function openTurn(journal: AgentSessionJournal, turnId: string): Promise<void> {
  await journal.appendItem(
    turnIdentity(turnId),
    { kind: 'turn', turnId, state: 'running' },
    { fence: 1 }
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-turn-settlement-'))
  clock = 1_000
})

afterEach(async () => {
  vi.restoreAllMocks()
  await journals.closeAll()
  await rm(root, { recursive: true, force: true })
})

describe('turn settlement dispatch resolution', () => {
  it('settles a pending submission when its turn is interrupted', async () => {
    const journal = await open()
    await openTurn(journal, 'turn-1')
    await appendPending(journal, 'message-1')

    const settlement = await journal.appendLifecycleBatch(terminalTurn('turn-1', 'interrupted'))

    expect(journal.submissions()).toEqual([
      expect.objectContaining({
        clientMessageId: 'message-1',
        dispatchState: 'unknown',
        reason: 'turn_settled_before_acknowledgement'
      })
    ])
    const afterSettlement = journal.readSince(settlement)
    expect(afterSettlement.ok && afterSettlement.rows).toEqual([
      expect.objectContaining({ kind: 'dispatch', state: 'unknown' })
    ])
  })

  it('settles a pending submission when its turn completes through the legacy carrier', async () => {
    const journal = await open()
    await openTurn(journal, 'turn-2')
    await appendPending(journal, 'message-2')

    await journal.appendLifecycleBatch({
      settlementId: 'completed:turn-2',
      fence: 1,
      mutations: [
        {
          kind: 'item',
          identity: turnIdentity('turn-2'),
          body: {
            kind: 'status',
            text: 'Done',
            turnLifecycle: { turnId: 'turn-2', state: 'completed' }
          }
        }
      ]
    })

    expect(journal.submissions()[0]).toMatchObject({
      dispatchState: 'unknown',
      reason: 'turn_settled_before_acknowledgement'
    })
  })

  it('settles preceding submissions when Claude appends a terminal turn item', async () => {
    const journal = await open()
    const identity = claudeTurnIdentity('claude-turn')
    await journal.appendItem(
      identity,
      { kind: 'turn', turnId: 'claude-turn', state: 'running' },
      { fence: 1 }
    )
    await appendPending(journal, 'claude-before-settlement')

    const settlement = journal.appendItem(
      identity,
      { kind: 'turn', turnId: 'claude-turn', state: 'completed' },
      { fence: 1 }
    )
    const laterSubmission = appendPending(journal, 'claude-after-settlement')
    await Promise.all([settlement, laterSubmission])

    expect(
      journal.submissions().map(({ clientMessageId, dispatchState, reason }) => ({
        clientMessageId,
        dispatchState,
        reason
      }))
    ).toEqual([
      {
        clientMessageId: 'claude-before-settlement',
        dispatchState: 'unknown',
        reason: 'turn_settled_before_acknowledgement'
      },
      {
        clientMessageId: 'claude-after-settlement',
        dispatchState: 'pending',
        reason: null
      }
    ])
  })

  it('does not settle a submission appended after the settlement row', async () => {
    const journal = await open()
    await openTurn(journal, 'turn-3')
    await appendPending(journal, 'before-settlement')

    const settlement = journal.appendLifecycleBatch(terminalTurn('turn-3', 'completed'))
    const laterSubmission = appendPending(journal, 'after-settlement')
    await Promise.all([settlement, laterSubmission])

    expect(
      journal.submissions().map(({ clientMessageId, dispatchState }) => ({
        clientMessageId,
        dispatchState
      }))
    ).toEqual([
      { clientMessageId: 'before-settlement', dispatchState: 'unknown' },
      { clientMessageId: 'after-settlement', dispatchState: 'pending' }
    ])
  })

  it('does not settle later submissions when a settlement id is replayed', async () => {
    const journal = await open()
    await openTurn(journal, 'turn-4')
    await appendPending(journal, 'original')
    const input = terminalTurn('turn-4', 'completed', 'stable-settlement')
    await journal.appendLifecycleBatch(input)
    await appendPending(journal, 'later')
    const beforeReplay = journal.cursor()

    const replay = await journal.appendLifecycleBatch(input)

    expect(replay).toEqual(beforeReplay)
    expect(journal.cursor()).toEqual(beforeReplay)
    expect(journal.submissions().find((entry) => entry.clientMessageId === 'later')).toMatchObject({
      dispatchState: 'pending'
    })
  })

  it('does not settle a pending submission from another fence', async () => {
    const journal = await open()
    await openTurn(journal, 'turn-fenced')
    await appendPending(journal, 'older-owner')
    const input = terminalTurn('turn-fenced', 'interrupted')

    await journal.appendLifecycleBatch({ ...input, fence: 2 })

    expect(journal.submissions()[0]).toMatchObject({ dispatchState: 'pending', fence: 1 })
  })

  it('does not overwrite an already accepted submission', async () => {
    const journal = await open()
    await openTurn(journal, 'turn-5')
    await appendPending(journal, 'accepted')
    const providerIdentity: AgentJournalItemIdentity = {
      provider: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-5',
      ordinal: 0
    }
    await journal.resolveDispatch({
      clientMessageId: 'accepted',
      state: 'accepted',
      providerIdentity,
      fence: 1
    })

    await journal.appendLifecycleBatch(terminalTurn('turn-5', 'completed'))

    expect(journal.submissions()[0]).toMatchObject({
      dispatchState: 'accepted',
      reason: null
    })
  })

  it('reports dispatch settlement failure without rejecting turn settlement', async () => {
    const journal = await open()
    await openTurn(journal, 'turn-6')
    await appendPending(journal, 'write-fails')
    const failure = new Error('disk unavailable')
    vi.spyOn(journal, 'resolveDispatch').mockRejectedValue(failure)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(
      journal.appendLifecycleBatch(terminalTurn('turn-6', 'interrupted'))
    ).resolves.toBeDefined()
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('could not settle submission write-fails'),
      failure
    )
    expect(journal.activeTurnId()).toBeNull()
    await expect(appendPending(journal, 'next-send')).resolves.toBeUndefined()
  })
})
