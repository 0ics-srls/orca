import { describe, expect, it } from 'vitest'
import { RuntimeRpcRequestAdmission } from '../../../src/main/runtime/runtime-rpc/runtime-rpc-request-admission'
import {
  LONG_POLL_CAP,
  ASK_LONG_POLL_SHARE,
  BROWSER_HOST_LONG_POLL_SHARE,
  SPECIALIZED_LONG_POLL_SHARE
} from '../../../src/main/runtime/runtime-rpc/runtime-rpc-long-poll'

describe('issue19342 check and workerStart share wait admission', () => {
  it('refuses workerStart at16 held checks, still permits short checks and recovers after one settles', async () => {
    const checks = []
    const dispatched = []
    const admission = Object.assign(Object.create(RuntimeRpcRequestAdmission.prototype), {
      authToken: 'audit-only',
      runtime: { getRuntimeId: () => 'audit-runtime' },
      activeLongPolls: 0,
      activeAskLongPolls: 0,
      activeBrowserHostLongPolls: 0,
      activeBrowserHostLongPollsByDevice: new Map(),
      longPollCap: LONG_POLL_CAP,
      askLongPollCap: Math.floor(LONG_POLL_CAP * ASK_LONG_POLL_SHARE),
      browserHostLongPollCap: Math.floor(LONG_POLL_CAP * BROWSER_HOST_LONG_POLL_SHARE),
      browserHostLongPollCapPerDevice: 4,
      specializedLongPollCap: Math.floor(LONG_POLL_CAP * SPECIALIZED_LONG_POLL_SHARE),
      dispatcher: {
        dispatch: async (request) => {
          dispatched.push(request.method)
          if (request.method === 'orchestration.check' && request.params.wait) {
            const completion = Promise.withResolvers()
            checks.push(completion)
            await completion.promise
          }
          return { id: request.id, ok: true, result: {} }
        }
      }
    })
    const call = (id, method, params = {}) =>
      admission.handleMessage(JSON.stringify({ id, method, params, authToken: 'audit-only' }))
    const waits = Array.from({ length: 16 }, (_, index) =>
      call(`check-${index}`, 'orchestration.check', { wait: true })
    )
    try {
      expect(admission.activeLongPolls).toBe(16)
      const denied = await call('denied', 'orchestration.workerStart')
      expect(denied).toMatchObject({
        ok: false,
        error: { code: 'runtime_busy', message: 'long-poll capacity reached; retry with backoff' }
      })
      expect(dispatched).not.toContain('orchestration.workerStart')
      await expect(call('short', 'orchestration.check', { wait: false })).resolves.toMatchObject({
        ok: true
      })
      checks[0].resolve()
      await waits[0]
      expect(admission.activeLongPolls).toBe(15)
      await expect(call('admitted', 'orchestration.workerStart')).resolves.toMatchObject({
        ok: true
      })
      expect(admission.activeLongPolls).toBe(15)
    } finally {
      for (const check of checks) {
        check.resolve()
      }
      await Promise.all(waits)
    }
    expect(admission.activeLongPolls).toBe(0)
  })
})
