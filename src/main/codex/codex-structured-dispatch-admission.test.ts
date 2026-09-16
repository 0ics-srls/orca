import { describe, expect, it } from 'vitest'
import { MAX_CODEX_PENDING_DISPATCH_ECHOES } from './codex-structured-dispatch-echo'
import {
  acquiredCodexAdapter,
  echoUserMessage,
  fakeCodexAppServer,
  recordingSink,
  startTurn,
  CODEX_TEST_THREAD_ID,
  CODEX_TEST_USER_MESSAGE,
  type LateSettlement
} from './codex-structured-dispatch-test-support'

function send(
  adapter: Awaited<ReturnType<typeof acquiredCodexAdapter>>,
  clientMessageId: string
): Promise<unknown> {
  return adapter.dispatch({
    sessionId: 'session-1',
    clientMessageId,
    body: CODEX_TEST_USER_MESSAGE,
    fence: 7
  })
}

describe('codex dispatch admission', () => {
  it('settles a successful steer with its exact active turn', async () => {
    const codex = fakeCodexAppServer({
      'turn/steer': () => ({ turnId: 'turn-1' })
    })
    const settlements: LateSettlement[] = []
    const ownerEnded: string[][] = []
    const sink = recordingSink()
    sink.appendLifecycleBatch = (_settlementId, _mutations, options) => {
      if (options?.ownerEndedClientMessageIds) {
        ownerEnded.push([...options.ownerEndedClientMessageIds])
      }
      return { accepted: true }
    }
    const adapter = await acquiredCodexAdapter({ codex, settlements, sink })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')

    await expect(send(adapter, 'client-1')).resolves.toEqual({ state: 'admitted' })
    connection.handlers.onNotification?.('turn/completed', {
      threadId: CODEX_TEST_THREAD_ID,
      turn: { id: 'turn-1', status: 'completed' }
    })
    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u1', clientId: 'client-1' })

    expect(ownerEnded).toEqual([['client-1']])
    expect(settlements).toEqual([expect.objectContaining({ clientMessageId: 'client-1' })])
  })

  it('does not late-settle when the terminal event precedes the steer response', async () => {
    let completeTurn: (() => void) | undefined
    const codex = fakeCodexAppServer({
      'turn/steer': () => {
        completeTurn?.()
        return { turnId: 'turn-1' }
      }
    })
    const settlements: LateSettlement[] = []
    const ownerEnded: string[][] = []
    const sink = recordingSink()
    sink.appendLifecycleBatch = (_settlementId, _mutations, options) => {
      ownerEnded.push([...(options?.ownerEndedClientMessageIds ?? [])])
      return { accepted: true }
    }
    const adapter = await acquiredCodexAdapter({ codex, settlements, sink })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')
    completeTurn = () =>
      connection.handlers.onNotification?.('turn/completed', {
        threadId: CODEX_TEST_THREAD_ID,
        turn: { id: 'turn-1', status: 'completed' }
      })

    await expect(send(adapter, 'client-1')).resolves.toEqual({ state: 'admitted' })
    expect(ownerEnded).toEqual([[]])

    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u1', clientId: 'client-1' })
    expect(settlements).toEqual([expect.objectContaining({ clientMessageId: 'client-1' })])
  })

  it.each(['response-first', 'started-first'] as const)(
    'requires a fresh-start response and started event (%s)',
    async (ordering) => {
      let connection: ReturnType<typeof fakeCodexAppServer>['connections'][number] | undefined
      const codex = fakeCodexAppServer({
        'turn/start': () => {
          if (ordering === 'started-first' && connection) {
            startTurn(connection, 'turn-new')
          }
          return { turn: { id: 'turn-new' } }
        }
      })
      const ownerEnded: string[][] = []
      const sink = recordingSink()
      sink.appendLifecycleBatch = (_settlementId, _mutations, options) => {
        ownerEnded.push([...(options?.ownerEndedClientMessageIds ?? [])])
        return { accepted: true }
      }
      const adapter = await acquiredCodexAdapter({ codex, settlements: [], sink })
      connection = codex.connections[0]!

      await expect(send(adapter, 'client-1')).resolves.toEqual({ state: 'admitted' })
      if (ordering === 'response-first') {
        startTurn(connection, 'turn-new')
      }
      connection.handlers.onNotification?.('turn/completed', {
        threadId: CODEX_TEST_THREAD_ID,
        turn: { id: 'turn-new', status: 'completed' }
      })

      expect(ownerEnded).toEqual([['client-1']])
    }
  )

  it('does not bind a stale active snapshot when the provider has advanced', async () => {
    const { CodexAppServerRequestError } = await import('./codex-app-server-connection')
    let connection: ReturnType<typeof fakeCodexAppServer>['connections'][number] | undefined
    const codex = fakeCodexAppServer({
      'turn/steer': () => {
        connection?.handlers.onNotification?.('turn/completed', {
          threadId: CODEX_TEST_THREAD_ID,
          turn: { id: 'turn-a', status: 'completed' }
        })
        if (connection) {
          startTurn(connection, 'turn-b')
        }
        throw new CodexAppServerRequestError(
          'turn/steer',
          -32602,
          'expected active turn id turn-a but found turn-b'
        )
      },
      // An older provider may answer this while keeping turn-b active. Without
      // a matching started event, turn-submission is not proven ownership.
      'turn/start': () => ({ turn: { id: 'turn-submission' } })
    })
    const settlements: LateSettlement[] = []
    const ownerEnded: string[][] = []
    const sink = recordingSink()
    sink.appendLifecycleBatch = (_settlementId, _mutations, options) => {
      ownerEnded.push([...(options?.ownerEndedClientMessageIds ?? [])])
      return { accepted: true }
    }
    const adapter = await acquiredCodexAdapter({ codex, settlements, sink })
    connection = codex.connections[0]!
    startTurn(connection, 'turn-a')

    await expect(send(adapter, 'client-1')).resolves.toEqual({ state: 'admitted' })
    connection.handlers.onNotification?.('turn/completed', {
      threadId: CODEX_TEST_THREAD_ID,
      turn: { id: 'turn-b', status: 'completed' }
    })

    expect(ownerEnded).toEqual([[], []])
    echoUserMessage(connection, {
      turnId: 'turn-b',
      itemId: 'item-u1',
      clientId: 'client-1'
    })
    expect(settlements).toEqual([expect.objectContaining({ clientMessageId: 'client-1' })])
  })

  it('falls back after a no-active steer and preserves exact fresh-turn ownership', async () => {
    const { CodexAppServerRequestError } = await import('./codex-app-server-connection')
    let connection: ReturnType<typeof fakeCodexAppServer>['connections'][number] | undefined
    const codex = fakeCodexAppServer({
      'turn/steer': () => {
        throw new CodexAppServerRequestError('turn/steer', -32602, 'no active turn to steer')
      },
      'turn/start': () => {
        if (connection) {
          startTurn(connection, 'turn-new')
        }
        return { turn: { id: 'turn-new' } }
      }
    })
    const ownerEnded: string[][] = []
    const sink = recordingSink()
    sink.appendLifecycleBatch = (_settlementId, _mutations, options) => {
      ownerEnded.push([...(options?.ownerEndedClientMessageIds ?? [])])
      return { accepted: true }
    }
    const adapter = await acquiredCodexAdapter({ codex, settlements: [], sink })
    connection = codex.connections[0]!
    startTurn(connection, 'stale-local-turn')

    await expect(send(adapter, 'client-1')).resolves.toEqual({ state: 'admitted' })
    connection.handlers.onNotification?.('turn/completed', {
      threadId: CODEX_TEST_THREAD_ID,
      turn: { id: 'turn-new', status: 'completed' }
    })

    expect(ownerEnded).toEqual([['client-1']])
    expect(connection.calls.map(({ method }) => method)).toContain('turn/steer')
    expect(connection.calls.map(({ method }) => method)).toContain('turn/start')
  })

  it('keeps an unsupported-steer fallback pending when start returns only a phantom id', async () => {
    const { CodexAppServerUnsupportedError } = await import('./codex-app-server-session')
    const codex = fakeCodexAppServer({
      'turn/steer': () => {
        throw new CodexAppServerUnsupportedError('turn/steer: method not found')
      },
      'turn/start': () => ({ turn: { id: 'phantom-turn' } })
    })
    const settlements: LateSettlement[] = []
    const ownerEnded: string[][] = []
    const sink = recordingSink()
    sink.appendLifecycleBatch = (_settlementId, _mutations, options) => {
      ownerEnded.push([...(options?.ownerEndedClientMessageIds ?? [])])
      return { accepted: true }
    }
    const adapter = await acquiredCodexAdapter({ codex, settlements, sink })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-active')

    await expect(send(adapter, 'client-1')).resolves.toEqual({ state: 'admitted' })
    connection.handlers.onNotification?.('turn/completed', {
      threadId: CODEX_TEST_THREAD_ID,
      turn: { id: 'turn-active', status: 'completed' }
    })

    expect(ownerEnded).toEqual([[]])
    echoUserMessage(connection, {
      turnId: 'turn-active',
      itemId: 'item-u1',
      clientId: 'client-1'
    })
    expect(settlements).toEqual([expect.objectContaining({ clientMessageId: 'client-1' })])
  })

  it('does not bind a successful steer response naming another turn', async () => {
    const codex = fakeCodexAppServer({ 'turn/steer': () => ({ turnId: 'turn-other' }) })
    const settlements: LateSettlement[] = []
    const ownerEnded: string[][] = []
    const sink = recordingSink()
    sink.appendLifecycleBatch = (_settlementId, _mutations, options) => {
      ownerEnded.push([...(options?.ownerEndedClientMessageIds ?? [])])
      return { accepted: true }
    }
    const adapter = await acquiredCodexAdapter({ codex, settlements, sink })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-active')

    await expect(send(adapter, 'client-1')).resolves.toEqual({ state: 'admitted' })
    connection.handlers.onNotification?.('turn/completed', {
      threadId: CODEX_TEST_THREAD_ID,
      turn: { id: 'turn-active', status: 'completed' }
    })

    expect(ownerEnded).toEqual([[]])
    echoUserMessage(connection, {
      turnId: 'turn-active',
      itemId: 'item-u1',
      clientId: 'client-1'
    })
    expect(settlements).toEqual([expect.objectContaining({ clientMessageId: 'client-1' })])
  })

  it('admits a send queued behind a running turn and settles it when Codex echoes it', async () => {
    const codex = fakeCodexAppServer({
      'turn/steer': () => ({ turnId: 'turn-1' })
    })
    const settlements: LateSettlement[] = []
    const adapter = await acquiredCodexAdapter({ codex, settlements })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')
    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u1', clientId: 'client-1' })

    const outcome = await send(adapter, 'client-2')

    // No doubt: elapsed time is not evidence, so nothing invites a Retry.
    expect(outcome).toEqual({ state: 'admitted' })
    expect(settlements).toEqual([])

    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u2', clientId: 'client-2' })

    // Ordinal 1, not 0: the queued send is the SECOND user message of the turn
    // it was coalesced into, which is the key a history replay computes for it.
    expect(settlements).toEqual([
      {
        sessionId: 'session-1',
        clientMessageId: 'client-2',
        providerIdentity: {
          provider: 'codex',
          threadId: CODEX_TEST_THREAD_ID,
          turnId: 'turn-1',
          ordinal: 1
        }
      }
    ])
  })

  it('correlates each send by client message id, not queue order', async () => {
    const codex = fakeCodexAppServer({ 'turn/steer': () => ({ turnId: 'turn-1' }) })
    const settlements: LateSettlement[] = []
    const adapter = await acquiredCodexAdapter({ codex, settlements })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')

    await send(adapter, 'client-1')
    await send(adapter, 'client-2')

    // The echoes arrive in the opposite order to the sends.
    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u2', clientId: 'client-2' })
    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u1', clientId: 'client-1' })

    // Ordinals follow the ECHO order, and each one lands on the send whose
    // `clientId` it carried -- not on the send that was queued in that slot.
    expect(settlements).toEqual([
      {
        sessionId: 'session-1',
        clientMessageId: 'client-2',
        providerIdentity: {
          provider: 'codex',
          threadId: CODEX_TEST_THREAD_ID,
          turnId: 'turn-1',
          ordinal: 0
        }
      },
      {
        sessionId: 'session-1',
        clientMessageId: 'client-1',
        providerIdentity: {
          provider: 'codex',
          threadId: CODEX_TEST_THREAD_ID,
          turnId: 'turn-1',
          ordinal: 1
        }
      }
    ])
  })

  it('settles nothing for a user message this session never sent', async () => {
    const codex = fakeCodexAppServer({ 'turn/steer': () => ({ turnId: 'turn-1' }) })
    const settlements: LateSettlement[] = []
    const adapter = await acquiredCodexAdapter({ codex, settlements })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')
    await send(adapter, 'client-1')

    // A message another client sent on the same thread, and one Codex did not
    // correlate at all.
    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-x', clientId: 'someone-else' })
    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-y' })

    expect(settlements).toEqual([])
  })

  it('rejects only when Codex answered and declined, and arms nothing for it', async () => {
    const { CodexAppServerRequestError } = await import('./codex-app-server-connection')
    const refuse = (method: string): never => {
      throw new CodexAppServerRequestError(method, -32602, 'thread not found')
    }
    const codex = fakeCodexAppServer({
      'turn/steer': () => refuse('turn/steer'),
      'turn/start': () => refuse('turn/start')
    })
    const settlements: LateSettlement[] = []
    const adapter = await acquiredCodexAdapter({ codex, settlements })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')

    expect(await send(adapter, 'client-1')).toEqual({
      state: 'rejected',
      reason: 'thread not found'
    })

    // A refused write is disarmed, so a later echo of that id settles nothing.
    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u1', clientId: 'client-1' })
    expect(settlements).toEqual([])
  })

  it('retains correlation when a request fails after its write may have landed', async () => {
    const codex = fakeCodexAppServer({
      'turn/steer': () => {
        throw new Error('request timed out after write')
      }
    })
    const settlements: LateSettlement[] = []
    const ownerEnded: string[][] = []
    const sink = recordingSink()
    sink.appendLifecycleBatch = (_settlementId, _mutations, options) => {
      ownerEnded.push([...(options?.ownerEndedClientMessageIds ?? [])])
      return { accepted: true }
    }
    const adapter = await acquiredCodexAdapter({ codex, settlements, sink })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')

    await expect(send(adapter, 'client-1')).rejects.toThrow('request timed out after write')
    connection.handlers.onNotification?.('turn/completed', {
      threadId: CODEX_TEST_THREAD_ID,
      turn: { id: 'turn-1', status: 'completed' }
    })
    expect(ownerEnded).toEqual([[]])
    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u1', clientId: 'client-1' })

    expect(settlements).toEqual([
      {
        sessionId: 'session-1',
        clientMessageId: 'client-1',
        providerIdentity: {
          provider: 'codex',
          threadId: CODEX_TEST_THREAD_ID,
          turnId: 'turn-1',
          ordinal: 0
        }
      }
    ])
  })

  it('refuses overflow without discarding an older accepted send', async () => {
    const codex = fakeCodexAppServer({ 'turn/steer': () => ({ turnId: 'turn-1' }) })
    const settlements: LateSettlement[] = []
    const adapter = await acquiredCodexAdapter({ codex, settlements })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')

    for (let index = 0; index < MAX_CODEX_PENDING_DISPATCH_ECHOES; index += 1) {
      expect(await send(adapter, `client-${index}`)).toEqual({ state: 'admitted' })
    }
    expect(await send(adapter, 'client-overflow')).toEqual({
      state: 'rejected',
      reason: 'codex structured dispatch queue is full'
    })

    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u0', clientId: 'client-0' })
    expect(settlements.map(({ clientMessageId }) => clientMessageId)).toEqual(['client-0'])
  })

  it('leaves no waiter behind when the session closes', async () => {
    const codex = fakeCodexAppServer({ 'turn/steer': () => ({ turnId: 'turn-1' }) })
    const settlements: LateSettlement[] = []
    const adapter = await acquiredCodexAdapter({ codex, settlements })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')
    await send(adapter, 'client-1')

    await adapter.closeSession('session-1')

    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u1', clientId: 'client-1' })
    expect(settlements).toEqual([])
  })

  it('leaves no waiter behind when the child exits', async () => {
    const codex = fakeCodexAppServer({ 'turn/steer': () => ({ turnId: 'turn-1' }) })
    const settlements: LateSettlement[] = []
    const adapter = await acquiredCodexAdapter({ codex, settlements })
    const connection = codex.connections[0]!
    startTurn(connection, 'turn-1')
    await send(adapter, 'client-1')

    connection.handlers.onExit?.(new Error('codex app-server exited'))

    echoUserMessage(connection, { turnId: 'turn-1', itemId: 'item-u1', clientId: 'client-1' })
    expect(settlements).toEqual([])
  })
})
