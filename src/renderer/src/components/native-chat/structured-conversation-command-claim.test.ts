import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentJournalSubmissionKey } from '../../../../shared/agent-session-journal-item-key'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import {
  CONVERSATION_COMMAND_DEADLINE_MS,
  StructuredConversationCommandClaim,
  type ConversationCommandReply
} from './structured-conversation-command-claim'

const OPERATION_ID = 'op-1'

function compactItem(
  operationId: string,
  state: 'running' | 'completed' | 'unconfirmed' | 'failed'
): AgentJournalRenderItem {
  return {
    itemId: agentJournalSubmissionKey(`compact:${operationId}`),
    revision: state === 'running' ? 1 : 2,
    sequence: 1,
    observedAt: 1,
    body: {
      kind: 'status',
      text:
        state === 'running'
          ? 'Compacting conversation…'
          : state === 'completed'
            ? 'Conversation compacted.'
            : state === 'unconfirmed'
              ? 'Compaction completion is unconfirmed.'
              : 'Provider refused compaction.',
      ...(state === 'running' || state === 'unconfirmed'
        ? { turnLifecycle: { turnId: `compact:${operationId}`, state: 'running' as const } }
        : {})
    }
  }
}

function neverReplies(): Promise<ConversationCommandReply> {
  return new Promise<ConversationCommandReply>(() => {})
}

type TrackedOutcome = { settled: boolean; accepted: boolean; error: string | null }

function track(promise: Promise<{ accepted: boolean; error: string | null }>): TrackedOutcome {
  const outcome: TrackedOutcome = { settled: false, accepted: false, error: null }
  void promise.then((value) => {
    outcome.settled = true
    outcome.accepted = value.accepted
    outcome.error = value.error
  })
  return outcome
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('StructuredConversationCommandClaim', () => {
  it('settles a compaction on its terminal frame even when no reply ever arrives', async () => {
    const claim = new StructuredConversationCommandClaim()

    const outcome = track(
      claim.run({
        command: 'compact',
        operationId: OPERATION_ID,
        blocked: false,
        send: neverReplies
      })
    )
    await vi.advanceTimersByTimeAsync(1)
    claim.applyStreamSnapshot([compactItem(OPERATION_ID, 'running')])
    expect(outcome.settled).toBe(false)
    expect(claim.isRunning).toBe(true)

    claim.applyStreamSnapshot([compactItem(OPERATION_ID, 'completed')])
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome).toMatchObject({ settled: true, accepted: true })
    expect(claim.isRunning).toBe(false)
  })

  it('refuses a second attempt after the deadline instead of racing the first', async () => {
    const claim = new StructuredConversationCommandClaim()
    const send = vi.fn(neverReplies)

    const first = track(
      claim.run({ command: 'compact', operationId: OPERATION_ID, blocked: false, send })
    )
    await vi.advanceTimersByTimeAsync(CONVERSATION_COMMAND_DEADLINE_MS + 1)

    expect(first).toMatchObject({ settled: true, accepted: false })
    expect(first.error).toContain('may still be running')
    expect(claim.isRunning).toBe(false)

    const second = track(
      claim.run({ command: 'compact', operationId: 'op-2', blocked: false, send })
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(second).toMatchObject({ settled: true, accepted: false })
    expect(second.error).toContain('may still be running')
    // The refusal is the point: only one attempt ever reached the host.
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('retires the marker when the terminal frame lands late', async () => {
    const claim = new StructuredConversationCommandClaim()
    const send = vi.fn(neverReplies)

    track(claim.run({ command: 'compact', operationId: OPERATION_ID, blocked: false, send }))
    await vi.advanceTimersByTimeAsync(CONVERSATION_COMMAND_DEADLINE_MS + 1)
    claim.applyStreamSnapshot([compactItem(OPERATION_ID, 'completed')])

    track(claim.run({ command: 'compact', operationId: 'op-2', blocked: false, send }))
    await vi.advanceTimersByTimeAsync(0)

    expect(send).toHaveBeenCalledTimes(2)
  })

  it('retires the marker on a restart or an interrupt', async () => {
    const claim = new StructuredConversationCommandClaim()
    const send = vi.fn(neverReplies)

    track(claim.run({ command: 'compact', operationId: OPERATION_ID, blocked: false, send }))
    await vi.advanceTimersByTimeAsync(CONVERSATION_COMMAND_DEADLINE_MS + 1)
    claim.reset()

    track(claim.run({ command: 'compact', operationId: 'op-2', blocked: false, send }))
    await vi.advanceTimersByTimeAsync(0)

    expect(send).toHaveBeenCalledTimes(2)
  })

  it('keeps waiting on a reply the host could not confirm', async () => {
    const claim = new StructuredConversationCommandClaim()

    const outcome = track(
      claim.run({
        command: 'compact',
        operationId: OPERATION_ID,
        blocked: false,
        send: async () => ({ result: { command: 'compact', state: 'unknown' }, unresolved: false })
      })
    )
    await vi.advanceTimersByTimeAsync(1)

    expect(outcome.settled).toBe(false)

    claim.applyStreamSnapshot([compactItem(OPERATION_ID, 'completed')])
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome).toMatchObject({ settled: true, accepted: true })
  })

  it('settles a clear on its committed reply', async () => {
    const claim = new StructuredConversationCommandClaim()

    const outcome = track(
      claim.run({
        command: 'clear',
        operationId: OPERATION_ID,
        blocked: false,
        send: async () => ({ result: { command: 'clear', state: 'completed' }, unresolved: false })
      })
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome).toMatchObject({ settled: true, accepted: true, error: null })
    expect(claim.isRunning).toBe(false)
  })

  it('keeps an unconfirmed host frame pending until the client deadline', async () => {
    const claim = new StructuredConversationCommandClaim()
    const outcome = track(
      claim.run({
        command: 'compact',
        operationId: OPERATION_ID,
        blocked: false,
        send: neverReplies
      })
    )

    claim.applyStreamSnapshot([compactItem(OPERATION_ID, 'unconfirmed')])
    await vi.advanceTimersByTimeAsync(CONVERSATION_COMMAND_DEADLINE_MS - 1)
    expect(outcome.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(2)
    expect(outcome).toMatchObject({ settled: true, accepted: false })
    expect(outcome.error).toContain('may still be running')
  })

  it('preserves a provider failure carried by the terminal frame', async () => {
    const claim = new StructuredConversationCommandClaim()
    const outcome = track(
      claim.run({
        command: 'compact',
        operationId: OPERATION_ID,
        blocked: false,
        send: neverReplies
      })
    )

    claim.applyStreamSnapshot([compactItem(OPERATION_ID, 'failed')])
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome).toMatchObject({
      settled: true,
      accepted: false,
      error: 'Provider refused compaction.'
    })
  })

  it('refuses a concurrent command while one is still outstanding', async () => {
    const claim = new StructuredConversationCommandClaim()
    const send = vi.fn(neverReplies)

    track(claim.run({ command: 'compact', operationId: OPERATION_ID, blocked: false, send }))
    const second = track(claim.run({ command: 'clear', operationId: 'op-2', blocked: false, send }))
    await vi.advanceTimersByTimeAsync(0)

    expect(second).toMatchObject({ settled: true, accepted: false })
    expect(second.error).toContain('Wait for the conversation operation to finish')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
