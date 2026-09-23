import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

const recordHostPlatformMock = vi.hoisted(() => vi.fn())

vi.mock('../transport/host-platform-store', () => ({
  recordHostPlatform: (...args: unknown[]) => recordHostPlatformMock(...args)
}))

import { fetchMobileHomeHostPlatform } from './mobile-home-host-platform-fetch'

function clientAnswering(reply: Promise<unknown>): RpcClient {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the status read sends only through sendRequest.
  return { sendRequest: vi.fn().mockReturnValue(reply) } as unknown as RpcClient
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
}

describe('fetchMobileHomeHostPlatform', () => {
  beforeEach(() => {
    recordHostPlatformMock.mockClear()
  })

  it('records the platform the host reports, and none for a host that reports none', async () => {
    fetchMobileHomeHostPlatform(
      clientAnswering(Promise.resolve({ ok: true, result: { hostPlatform: 'darwin' } })),
      'host-1',
      () => false
    )
    fetchMobileHomeHostPlatform(
      clientAnswering(Promise.resolve({ ok: true, result: { appVersion: '1.0.0' } })),
      'host-old',
      () => false
    )
    await settle()

    expect(recordHostPlatformMock.mock.calls).toEqual([
      ['host-1', 'darwin'],
      ['host-old', null]
    ])
  })

  it('keeps the record when the read is refused, fails, or lands after teardown', async () => {
    fetchMobileHomeHostPlatform(
      clientAnswering(Promise.resolve({ ok: false, error: { code: 'refused', message: 'no' } })),
      'host-refused',
      () => false
    )
    fetchMobileHomeHostPlatform(
      clientAnswering(Promise.reject(new Error('socket closed'))),
      'host-failed',
      () => false
    )
    fetchMobileHomeHostPlatform(
      clientAnswering(Promise.resolve({ ok: true, result: { hostPlatform: 'win32' } })),
      'host-disposed',
      () => true
    )
    await settle()

    expect(recordHostPlatformMock).not.toHaveBeenCalled()
  })
})
