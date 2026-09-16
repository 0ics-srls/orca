import { afterAll, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { RelayDispatcher } from '../../../src/relay/dispatcher'
import { encodeJsonRpcFrame } from '../../../src/relay/protocol'
import { RecentPtyOutputBuffer } from '../../../src/main/runtime/recent-pty-output-buffer'
import { PtyHandler, REPLAY_BUFFER_MAX } from '../../../src/relay/pty-handler'

vi.mock('node-pty', () => ({
  spawn: () => {
    throw new Error('No native spawn permitted')
  }
}))
const observations: unknown[] = []
const baseline = process.env.RECONNECT_PROOF_BASELINE === '1'
afterAll(() => {
  const output = process.env.REPLAY_PROOF_OUTPUT
  if (output) {
    writeFileSync(output, JSON.stringify(observations, null, 2))
  }
})

async function attempt(payload: string, count: number, suppressed: boolean) {
  const frames: Buffer[] = []
  let closes = 0
  const dispatcher = new RelayDispatcher(
    (data, settled) => {
      frames.push(Buffer.from(data))
      setImmediate(() => settled({ ok: true }))
      return true
    },
    {
      supportsWriteCallback: true,
      close: () => {
        closes++
      }
    }
  )
  const handler = new PtyHandler(dispatcher, 0, 'reconnect-proof')
  const pool = Reflect.get(handler, 'ptys')
  if (!(pool instanceof Map)) {
    throw new Error('PTY pool changed')
  }
  try {
    for (let i = 1; i <= count; i++) {
      const id = `proof-${i}`
      const buffered = new RecentPtyOutputBuffer({ limit: REPLAY_BUFFER_MAX })
      buffered.append(payload)
      pool.set(id, {
        id,
        incarnationId: `inc-${i}`,
        pty: { pid: process.pid },
        disposed: false,
        buffered
      })
    }
    dispatcher.feed(
      Buffer.concat(
        Array.from({ length: count }, (_, index) =>
          encodeJsonRpcFrame(
            {
              jsonrpc: '2.0',
              id: index + 1,
              method: 'pty.attach',
              params: {
                id: `proof-${index + 1}`,
                suppressReplayNotification: suppressed,
                requireReplay: true
              }
            },
            index + 1,
            0
          )
        )
      )
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    const decoded = frames.map((frame) => JSON.parse(frame.subarray(13).toString('utf8')))
    return {
      closes,
      ptys: handler.activePtyCount,
      successfulReplays: decoded.filter((x) => x.result?.replay).length,
      capacityErrors: decoded.filter((x) => x.error?.message.includes('capacity')).length,
      replayNotifications: decoded.filter((x) => x.method === 'pty.replay').length,
      frames: frames.length,
      bytes: frames.reduce((sum, frame) => sum + frame.length, 0)
    }
  } finally {
    pool.clear()
    await handler.dispose({ waitForPhysicalExit: false })
    dispatcher.dispose()
  }
}

describe('bounded actual attach replay publication', () => {
  it('keeps an eight-PTY ASCII burst connected', async () => {
    const result = await attempt('x'.repeat(REPLAY_BUFFER_MAX), 8, true)
    observations.push({ scenario: '8 ASCII RPC replies', result })
    expect(result).toMatchObject({
      closes: 0,
      ptys: 8,
      successfulReplays: 8,
      replayNotifications: 0,
      capacityErrors: 0
    })
  })
  it('distinguishes historical fatal admission from current per-request failure across three retries', async () => {
    const unit = '\u001b[31mX\u001b[0m'
    const payload = unit
      .repeat(Math.ceil(REPLAY_BUFFER_MAX / unit.length))
      .slice(-REPLAY_BUFFER_MAX)
    const results = []
    for (let i = 0; i < 3; i++) {
      results.push(await attempt(payload, 8, true))
    }
    observations.push({
      scenario: '8 ANSI RPC replies, three independent reconnect attempts',
      payloadCodeUnits: payload.length,
      results
    })
    for (const result of results) {
      expect(result.ptys).toBe(8)
      expect(result.replayNotifications).toBe(0)
      expect(result.closes).toBe(baseline ? 1 : 0)
      expect(result.successfulReplays).toBe(5)
      expect(result.capacityErrors).toBe(baseline ? 0 : 3)
    }
  })
  it('records the legacy notification path separately', async () => {
    const result = await attempt('x'.repeat(REPLAY_BUFFER_MAX), 11, false)
    observations.push({ scenario: '11 legacy unsuppressed notifications', result })
    expect(result.closes).toBe(1)
    expect(result.replayNotifications).toBe(10)
    expect(result.ptys).toBe(11)
  })
})
