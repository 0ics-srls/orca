import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { approvalItem } from './mobile-structured-agent-session-test-fixtures'
import { useMobileStructuredAgentSessionCancel } from './use-mobile-structured-agent-session-cancel'

function ok(result: unknown) {
  return { ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function acceptedCancellation(replayed: boolean) {
  return ok({
    ok: true,
    replayed,
    fence: 3,
    cursor: { epoch: 'epoch-1', sequence: 4 },
    value: { turnId: 'turn-1', cancelled: true }
  })
}

describe('useMobileStructuredAgentSessionCancel', () => {
  let renderer: ReactTestRenderer | null = null
  let cancel: (() => void) | null = null
  const operationIds = new Map<string, string>()
  const onSendError = vi.fn()
  const onCancelResolved = vi.fn()
  const sendRequest = vi.fn(async (_method: string, _params: unknown, _options: unknown) =>
    acceptedCancellation(false)
  )
  const client = { sendRequest } as unknown as RpcClient
  const stateRef = {
    current: {
      fence: 3,
      items: [approvalItem()]
    }
  }

  function Harness(): null {
    cancel = useMobileStructuredAgentSessionCancel({
      client,
      sessionId: 'session-1',
      sessionKey: 'session-key',
      enabled: true,
      promptCancelSupported: true,
      stateRef,
      operationIdsRef: { current: operationIds },
      onSendError,
      onCancelResolved
    } as never)
    return null
  }

  async function cancelAndFlush(): Promise<void> {
    await act(async () => {
      cancel?.()
      await Promise.resolve()
    })
  }

  function cancellationOperationIds(): string[] {
    return sendRequest.mock.calls.map(
      ([, params]) =>
        (params as { envelope: { clientOperationId: string } }).envelope.clientOperationId
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    operationIds.clear()
    sendRequest.mockImplementation(async () => acceptedCancellation(false))
    act(() => {
      renderer = create(createElement(Harness))
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    cancel = null
  })

  it.each([
    {
      label: 'unknown',
      code: 'agent_session_operation_unknown',
      message: 'Cancellation unconfirmed',
      expectedError: 'Stop unconfirmed — check chat before retrying',
      reusesOperationId: true
    },
    {
      label: 'settled',
      code: 'agent_session_operation_conflict',
      message: 'Cancellation conflicts with another operation',
      expectedError: 'Cancellation conflicts with another operation',
      reusesOperationId: false
    }
  ])(
    '$label prompt cancellation refusals preserve the correct retry identity',
    async ({ code, message, expectedError, reusesOperationId }) => {
      let attempts = 0
      sendRequest.mockImplementation(async () =>
        attempts++ === 0
          ? ok({ ok: false, refusal: { code, message } })
          : acceptedCancellation(reusesOperationId)
      )

      await cancelAndFlush()
      expect(onSendError).toHaveBeenCalledWith(expectedError)
      await cancelAndFlush()

      const ids = cancellationOperationIds()
      expect(ids).toHaveLength(2)
      expect(ids[1] === ids[0]).toBe(reusesOperationId)
      expect(onCancelResolved).toHaveBeenCalledOnce()
    }
  )

  it('releases the prompt cancellation operation id after success', async () => {
    await cancelAndFlush()
    await cancelAndFlush()

    const ids = cancellationOperationIds()
    expect(ids).toHaveLength(2)
    expect(ids[1]).not.toBe(ids[0])
    expect(onSendError).not.toHaveBeenCalled()
    expect(onCancelResolved).toHaveBeenCalledTimes(2)
  })
})
