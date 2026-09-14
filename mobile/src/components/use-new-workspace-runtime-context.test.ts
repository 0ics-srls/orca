import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useNewWorkspaceRuntimeContext } from './use-new-workspace-runtime-context'

type RuntimeContext = ReturnType<typeof useNewWorkspaceRuntimeContext>

const TRUSTED_HOOKS = { '/repo/orca.yaml': 'sha-1' }

function reply(result: unknown): RpcResponse {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test scripts raw host replies, not validated payloads.
  return { id: 'r', ok: true, result, _meta: { runtimeId: 'runtime-1' } } as RpcResponse
}

/** Every prerequisite answers normally; only the settings result varies. */
function clientAnsweringSettingsWith(settingsResult: unknown): RpcClient {
  const sendRequest = vi.fn(async (method: string) => {
    switch (method) {
      case 'settings.get':
        return reply(settingsResult)
      case 'ui.get':
        return reply({ ui: { trustedOrcaHooks: TRUSTED_HOOKS } })
      case 'preflight.check':
        return reply({ glab: { installed: false } })
      default:
        return reply({ connected: false })
    }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reaches only sendRequest on the client.
  return { sendRequest } as unknown as RpcClient
}

describe('useNewWorkspaceRuntimeContext', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function mount(settingsResult: unknown): Promise<RuntimeContext> {
    // One client for the whole mount: the hook keys its effect on client identity.
    const client = clientAnsweringSettingsWith(settingsResult)
    let context!: RuntimeContext
    function Harness(): null {
      context = useNewWorkspaceRuntimeContext(client, true)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {})
    return context
  }

  it('degrades a null result the way a reply without a settings member degrades', async () => {
    const absent = await mount({})
    const absentState = {
      runtimeSettings: absent.runtimeSettings,
      trustedOrcaHooks: absent.trustedOrcaHooks,
      availableProviders: absent.availableProviders
    }
    act(() => renderer?.unmount())
    renderer = null

    const nullResult = await mount(null)
    expect({
      runtimeSettings: nullResult.runtimeSettings,
      trustedOrcaHooks: nullResult.trustedOrcaHooks,
      availableProviders: nullResult.availableProviders
    }).toEqual(absentState)
    // The state the property-read TypeError used to skip on its way out of the effect.
    expect(absentState).toEqual({
      runtimeSettings: null,
      trustedOrcaHooks: TRUSTED_HOOKS,
      availableProviders: ['github']
    })
  })

  it('degrades an absent result the same way', async () => {
    const context = await mount(undefined)
    expect(context.runtimeSettings).toBeNull()
    expect(context.trustedOrcaHooks).toEqual(TRUSTED_HOOKS)
    expect(context.availableProviders).toEqual(['github'])
  })

  it('publishes the settings a host does send', async () => {
    const context = await mount({
      settings: { defaultTuiAgent: 'codex', visibleTaskProviders: ['github', 'linear'] }
    })
    expect(context.runtimeSettings).toEqual({
      defaultTuiAgent: 'codex',
      visibleTaskProviders: ['github', 'linear']
    })
    expect(context.availableProviders).toEqual(['github'])
  })
})
