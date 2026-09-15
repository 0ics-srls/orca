import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(() => ({ identity: { state: 'missing' }, migrationNotice: null })),
  set: vi.fn(async () => ({ ok: true }))
}))

vi.mock('../../../browser/browser-identity-mode-record', () => ({
  getBrowserIdentityModeStatus: mocks.get,
  setBrowserIdentityMode: mocks.set
}))

import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { BROWSER_CORE_METHODS } from './browser-core'

function request(method: string, params?: unknown): RpcRequest {
  return { id: 'identity-1', authToken: 'token', method, params }
}

describe('browser identity RPC', () => {
  it('serves the host-local identity snapshot', async () => {
    const runtime = { getRuntimeId: () => 'runtime-1' } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: BROWSER_CORE_METHODS })

    const response = await dispatcher.dispatch(request('browser.identity.get'))

    expect(response).toMatchObject({ ok: true, result: { migrationNotice: null } })
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('commits a host-local identity selection', async () => {
    const runtime = { getRuntimeId: () => 'runtime-1' } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: BROWSER_CORE_METHODS })

    await dispatcher.dispatch(request('browser.identity.set', { mode: 'native' }))

    expect(mocks.set).toHaveBeenCalledWith('native')
  })
})
