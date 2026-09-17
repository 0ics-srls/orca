import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { readCodexRateLimitsViaRpc } from '../../../src/main/rate-limits/codex-rpc-rate-limit-probe'
import { terminateCodexProbeChild } from '../../../src/main/rate-limits/codex-probe-termination'
describe('issue 15098 current Linux silent child control', () => {
  it('releases the RPC wait after init timeout, graceful drain and bounded hard-kill wait', async () => {
    vi.useFakeTimers()
    try {
      const events = new EventEmitter()
      const child = Object.assign(events, {
        pid: 999999999,
        exitCode: null,
        signalCode: null,
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() }),
        kill: vi.fn((_signal) => true)
      })
      let settled = false
      const promise = readCodexRateLimitsViaRpc({
        child,
        codexCommand: 'codex',
        initTimeoutMs: 3e4,
        rpcTimeoutMs: 1e4,
        terminate: () => terminateCodexProbeChild(child, { platform: 'linux' })
      }).then((result) => {
        settled = true
        return result
      })
      await vi.advanceTimersByTimeAsync(29999)
      expect(settled).toBe(false)
      expect(child.kill).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      expect(child.stdout.listenerCount('data')).toBe(0)
      await vi.advanceTimersByTimeAsync(5e3)
      expect(child.kill.mock.calls.map((call) => call[0])).toEqual(['SIGTERM', 'SIGKILL'])
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1e3)
      await expect(promise).resolves.toMatchObject({ status: 'error', error: 'RPC timeout' })
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
