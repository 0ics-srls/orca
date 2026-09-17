import { EventEmitter } from 'node:events'
import { writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnixSocketTransport } from '../../../src/main/runtime/rpc/unix-socket-transport'
import { RuntimeRpcRequestAdmission } from '../../../src/main/runtime/runtime-rpc/runtime-rpc-request-admission'
import { RpcDispatcher } from '../../../src/main/runtime/rpc/dispatcher'
import { WORKTREE_CATALOG_METHODS } from '../../../src/main/runtime/rpc/methods/worktree-catalog-methods'
import { TERMINAL_LIFECYCLE_METHODS } from '../../../src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods'

class FakeSocket extends EventEmitter {
  destroyed = false
  writable = true
  writes = []
  setEncoding() {}
  setNoDelay() {}
  setTimeout(_ms, callback) {
    this.expire = callback
  }
  write(value) {
    this.writes.push(JSON.parse(value))
    return true
  }
  end() {
    this.destroy()
  }
  destroy() {
    if (!this.destroyed) {
      this.destroyed = true
      this.writable = false
      this.emit('close')
    }
    return this
  }
}

describe('ordinary RPC admission capacity diagnostic', () => {
  afterEach(() => vi.restoreAllMocks())

  it('distinguishes ordinary pending calls from admitted long polls and verifies settlement', async () => {
    expect(process.env.ORCA_BACKGROUND_LAUNCH).toBe('1')
    const pending = []
    let live = 0
    let longPollStarted = 0
    const runtime = {
      getRuntimeId: () => 'fixture-runtime',
      listManagedWorktrees: () => {
        live += 1
        return new Promise((resolve) =>
          pending.push(() => {
            live -= 1
            resolve({ worktrees: [], totalCount: 0 })
          })
        )
      },
      waitForTerminal: (_terminal, { signal }) => {
        longPollStarted += 1
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        )
      }
    }
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: [...WORKTREE_CATALOG_METHODS, ...TERMINAL_LIFECYCLE_METHODS]
    })
    const dispatch = dispatcher.dispatch.bind(dispatcher)
    let shortSignals = 0
    vi.spyOn(dispatcher, 'dispatch').mockImplementation((request, options) => {
      if (request.method === 'worktree.list' && options.signal !== undefined) {
        shortSignals += 1
      }
      return dispatch(request, options)
    })
    // Avoid constructor side effects; all auth, admission, dispatch and method code below is actual source.
    const admission = Object.create(RuntimeRpcRequestAdmission.prototype)
    Object.assign(admission, {
      runtime,
      dispatcher,
      authToken: 'fixture-token',
      activeLongPolls: 0,
      activeAskLongPolls: 0,
      activeBrowserHostLongPolls: 0,
      activeBrowserHostLongPollsByDevice: new Map(),
      longPollCap: 16,
      askLongPollCap: 8,
      browserHostLongPollCap: 8,
      browserHostLongPollCapPerDevice: 4,
      specializedLongPollCap: 12
    })
    const transport = new UnixSocketTransport({ endpoint: 'inert-fixture', kind: 'named-pipe' })
    const calls = []
    const signals = []
    transport.onMessage((raw, reply, context) => {
      signals.push(context.signal)
      calls.push(
        admission.handleMessage(raw, context).then((response) => reply(JSON.stringify(response)))
      )
    })
    const send = (socket, id, method, params) =>
      socket.emit('data', `${JSON.stringify({ id, method, params, authToken: 'fixture-token' })}\n`)
    const socket = new FakeSocket()
    transport.handleConnection(socket)
    for (let i = 0; i < 128; i += 1) {
      send(socket, `ordinary-${i}`, 'worktree.list', {})
    }
    await vi.waitFor(() => expect(live).toBe(128))
    expect(admission.activeLongPolls).toBe(0)
    expect(shortSignals).toBe(0)
    expect(socket.writes).toHaveLength(0)
    socket.destroy()
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(live).toBe(128)
    for (const resolve of pending) {
      resolve()
    }
    await Promise.all(calls)
    expect(live).toBe(0)
    expect(socket.writes).toHaveLength(0)
    expect(transport.activeSockets.size).toBe(0)

    const waits = new FakeSocket()
    transport.handleConnection(waits)
    for (let i = 0; i < 32; i += 1) {
      send(waits, `long-${i}`, 'terminal.wait', { terminal: 'term', for: 'exit' })
    }
    await vi.waitFor(() => expect(longPollStarted).toBe(16))
    expect(admission.activeLongPolls).toBe(16)
    await vi.waitFor(() => expect(waits.writes).toHaveLength(16))
    expect(waits.writes.every((frame) => frame.error?.code === 'runtime_busy')).toBe(true)
    waits.destroy()
    await Promise.all(calls)
    expect(admission.activeLongPolls).toBe(0)
    expect(transport.activeSockets.size).toBe(0)

    const sources = [
      'src/main/runtime/rpc/unix-socket-transport.ts',
      'src/main/runtime/runtime-rpc/runtime-rpc-request-admission.ts',
      'src/main/runtime/runtime-rpc/runtime-rpc-long-poll.ts',
      'src/main/runtime/rpc/dispatcher.ts',
      'src/main/runtime/rpc/dispatcher-unary-method-invocation.ts',
      'src/main/runtime/rpc/methods/worktree-catalog-methods.ts',
      'src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts'
    ]
    const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
    writeFileSync(
      'docs/audits/rpc-inflight-admission-review/results.json',
      `${JSON.stringify(
        {
          runtime: process.versions.node,
          sourceHashes: Object.fromEntries(
            sources.map((source) => [
              source,
              sha(readFileSync(source, 'utf8').replaceAll('\r\n', '\n'))
            ])
          ),
          fixtureSha256: sha(readFileSync(import.meta.filename)),
          observations: {
            ordinaryCallsOnOneConnection: 128,
            ordinarySignalsPassed: shortSignals,
            ordinaryCallsAfterSocketClose: 128,
            ordinaryCallsAfterProviderSettlement: live,
            longPollsOffered: 32,
            longPollsAdmitted: longPollStarted,
            longPollsRejected: 16,
            longPollsAfterSocketClose: admission.activeLongPolls
          },
          limits: [
            'Fake socket; no real network, native process, filesystem stall or affected host.',
            'Actual auth/admission, dispatcher and two production methods; runtime provider operations deliberately deferred.',
            'Demonstrates conditional pending-request accumulation; does not establish a permanently pending production provider or retained bytes.',
            'Ordinary operations settle and transport cleanup completes; long polls remain admitted and aborted as designed.'
          ]
        },
        null,
        2
      )}\n`
    )
  })
})
