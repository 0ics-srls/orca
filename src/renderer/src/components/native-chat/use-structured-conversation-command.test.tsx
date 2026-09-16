// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentJournalSubmissionKey } from '../../../../shared/agent-session-journal-item-key'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

import { CONVERSATION_COMMAND_DEADLINE_MS } from './structured-conversation-command-claim'
import { useStructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import { useStructuredConversationCommand } from './use-structured-conversation-command'

const LOCAL_TARGET = { kind: 'local' } as const

function useCommandHarness(props: { fence: number; items: readonly AgentJournalRenderItem[] }) {
  const stateRef = useRef<{ fence: number | null }>({ fence: props.fence })
  useEffect(() => {
    stateRef.current = { fence: props.fence }
  }, [props.fence])
  const mutation = useStructuredAgentSessionMutate({
    sessionId: 'session-1',
    target: LOCAL_TARGET,
    stateRef
  })
  const command = useStructuredConversationCommand({
    sessionId: 'session-1',
    fence: props.fence,
    items: props.items,
    blocked: false,
    mutate: mutation.mutate,
    onReconciled: mutation.clearWriteError
  })
  return { ...command, mutate: mutation.mutate, writeError: mutation.writeError }
}

function completedCompact(operationId: string): AgentJournalRenderItem {
  return {
    itemId: agentJournalSubmissionKey(`compact:${operationId}`),
    revision: 2,
    sequence: 1,
    observedAt: 1,
    body: { kind: 'status', text: 'Conversation compacted.' }
  }
}

describe('useStructuredConversationCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reuses an unresolved clear identity after a host restart', async () => {
    vi.useFakeTimers()
    mocks.call.mockRejectedValue(new Error('connection lost'))
    const initialProps: { fence: number; items: AgentJournalRenderItem[] } = {
      fence: 1,
      items: []
    }
    const view = renderHook((props) => useCommandHarness(props), { initialProps })

    let first!: Awaited<ReturnType<typeof view.result.current.run>>
    await act(async () => {
      const pending = view.result.current.run('clear')
      await vi.advanceTimersByTimeAsync(CONVERSATION_COMMAND_DEADLINE_MS + 1)
      first = await pending
    })
    expect(first.accepted).toBe(false)
    const firstOperationId = mocks.call.mock.calls[0]![2].envelope.clientOperationId

    view.rerender({ fence: 2, items: [] })
    let second!: Promise<unknown>
    act(() => {
      second = view.result.current.run('clear')
    })
    expect(mocks.call.mock.calls[1]![2].envelope.clientOperationId).toBe(firstOperationId)

    act(() => view.result.current.retire())
    await second
  })

  it('retires an expired clear on its late reply and gives the next command a fresh identity', async () => {
    vi.useFakeTimers()
    const firstReply = Promise.withResolvers<{
      ok: true
      value: { command: 'clear'; state: 'completed' }
    }>()
    mocks.call
      .mockImplementationOnce(() => firstReply.promise)
      .mockImplementation(() => new Promise(() => {}))
    const view = renderHook(() => useCommandHarness({ fence: 1, items: [] }))

    let first!: ReturnType<typeof view.result.current.run>
    act(() => {
      first = view.result.current.run('clear')
    })
    const firstOperationId = mocks.call.mock.calls[0]![2].envelope.clientOperationId
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONVERSATION_COMMAND_DEADLINE_MS + 1)
    })
    await expect(first).resolves.toMatchObject({ accepted: false })

    await act(async () => {
      firstReply.resolve({ ok: true, value: { command: 'clear', state: 'completed' } })
      await firstReply.promise
      await Promise.resolve()
    })

    let second!: ReturnType<typeof view.result.current.run>
    act(() => {
      second = view.result.current.run('clear')
    })
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(mocks.call.mock.calls[1]![2].envelope.clientOperationId).not.toBe(firstOperationId)

    act(() => view.unmount())
    await second
  })

  it('clears a late transport error after the journal already settled the command', async () => {
    let reject!: (error: Error) => void
    mocks.call.mockImplementation(
      () =>
        new Promise((_resolve, rejectCall) => {
          reject = rejectCall
        })
    )
    const initialProps: { fence: number; items: AgentJournalRenderItem[] } = {
      fence: 1,
      items: []
    }
    const view = renderHook((props) => useCommandHarness(props), { initialProps })

    let pending!: ReturnType<typeof view.result.current.run>
    act(() => {
      pending = view.result.current.run('compact')
    })
    const operationId = mocks.call.mock.calls[0]![2].envelope.clientOperationId
    view.rerender({ fence: 1, items: [completedCompact(operationId)] })

    await expect(pending).resolves.toEqual({ accepted: true, error: null })
    await act(async () => {
      reject(new Error('connection lost'))
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.writeError).toBeNull())
  })

  it('does not clear an error owned by a different mutation', async () => {
    let resolveCommand!: (value: unknown) => void
    mocks.call.mockImplementation((_target, method) => {
      if (method === 'agentSession.conversationCommand') {
        return new Promise((resolve) => {
          resolveCommand = resolve
        })
      }
      return Promise.reject(new Error('option failed'))
    })
    const initialProps: { fence: number; items: AgentJournalRenderItem[] } = {
      fence: 1,
      items: []
    }
    const view = renderHook((props) => useCommandHarness(props), { initialProps })

    let pending!: ReturnType<typeof view.result.current.run>
    act(() => {
      pending = view.result.current.run('compact')
    })
    const operationId = mocks.call.mock.calls[0]![2].envelope.clientOperationId
    await act(async () => {
      await view.result.current.mutate('agentSession.setOption', 'agentSession.setOption', {
        key: 'effort',
        value: 'high'
      })
    })
    expect(view.result.current.writeError).toBe('option failed')

    view.rerender({ fence: 1, items: [completedCompact(operationId)] })
    await expect(pending).resolves.toEqual({ accepted: true, error: null })
    expect(view.result.current.writeError).toBe('option failed')

    await act(async () => {
      resolveCommand({ ok: true, value: { command: 'compact', state: 'completed' } })
      await Promise.resolve()
    })
    expect(view.result.current.writeError).toBe('option failed')
  })
})
