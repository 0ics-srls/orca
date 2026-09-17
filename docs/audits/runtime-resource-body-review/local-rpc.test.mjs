import { afterEach, describe, expect, it, vi } from 'vitest'
import { callRuntimeRpc } from '../../../src/renderer/src/runtime/runtime-rpc-client'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('issue19660 current local RPC options', () => {
  it('stays pending beyond caller deadline and abort until underlying IPC resolves', async () => {
    vi.useFakeTimers()
    const raw = Promise.withResolvers()
    const call = vi.fn(() => raw.promise)
    vi.stubGlobal('window', { api: { runtime: { call } } })
    const controller = new AbortController()
    let settled = false
    const result = callRuntimeRpc({ kind: 'local' }, 'automation.list', undefined, {
      timeoutMs: 15_000,
      signal: controller.signal
    })
    void result.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await vi.advanceTimersByTimeAsync(15_001)
    expect(settled).toBe(false)
    controller.abort()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(false)
    expect(call).toHaveBeenCalledExactlyOnceWith({ method: 'automation.list', params: undefined })
    raw.resolve({ ok: true, result: { automations: [] } })
    await expect(result).resolves.toEqual({ automations: [] })
  })

  it('rejects pre-aborted input before local dispatch', async () => {
    const call = vi.fn()
    vi.stubGlobal('window', { api: { runtime: { call } } })
    const controller = new AbortController()
    controller.abort()
    await expect(
      callRuntimeRpc({ kind: 'local' }, 'automation.list', undefined, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(call).not.toHaveBeenCalled()
  })
})
