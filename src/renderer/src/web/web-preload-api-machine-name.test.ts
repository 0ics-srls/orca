import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

describe('web machine name setting', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads and renames the paired runtime instead of keeping a name nothing publishes', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    let published = 'Build server'
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          if (
            method === 'settings.update' &&
            typeof params === 'object' &&
            params !== null &&
            'machineName' in params
          ) {
            published = String(params.machineName)
          }
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: { settings: { machineName: published } },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    expect((await globals.window.api.settings.get()).machineName).toBe('Build server')
    const next = await globals.window.api.settings.set({ machineName: '  QA desk  ' })
    expect(next.machineName).toBe('QA desk')
    expect(runtimeCalls).toEqual([
      { method: 'settings.get', params: undefined },
      { method: 'settings.update', params: { machineName: 'QA desk' } }
    ])
    expect(JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}').machineName).toBe(
      'QA desk'
    )
  })
})
