import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useNewWorkspaceRuntimeContext } from './use-new-workspace-runtime-context'

type RuntimeContext = ReturnType<typeof useNewWorkspaceRuntimeContext>
type PublishedState = Pick<
  RuntimeContext,
  'runtimeSettings' | 'trustedOrcaHooks' | 'availableProviders'
>

const TRUSTED_HOOKS = { '/repo/orca.yaml': 'sha-1' }
const UI_WITH_TRUST = { ui: { trustedOrcaHooks: TRUSTED_HOOKS } }
const SETTINGS = { defaultTuiAgent: 'codex', visibleTaskProviders: ['github', 'linear'] }

function reply(result: unknown): RpcResponse {
  return { id: 'r', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

/** Every prerequisite answers normally; only the two reads under test vary. */
function clientAnswering(settingsResult: unknown, uiResult: unknown): RpcClient {
  const client = new FakeSession('connected')
  client.sendRequest.mockImplementation(async (method: string) => {
    switch (method) {
      case 'settings.get':
        return reply(settingsResult)
      case 'ui.get':
        return reply(uiResult)
      case 'preflight.check':
        return reply({ glab: { installed: false } })
      default:
        return reply({ connected: false })
    }
  })
  return client
}

describe('useNewWorkspaceRuntimeContext', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function mount(settingsResult: unknown, uiResult: unknown): Promise<PublishedState> {
    // One client for the whole mount: the hook keys its effect on client identity.
    const client = clientAnswering(settingsResult, uiResult)
    let context!: RuntimeContext
    function Harness(): null {
      context = useNewWorkspaceRuntimeContext(client, true)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {})
    const { runtimeSettings, trustedOrcaHooks, availableProviders } = context
    return { runtimeSettings, trustedOrcaHooks, availableProviders }
  }

  // A null result used to throw the `settings` property read out of the effect, skipping the
  // provider commit the absent case still reached.
  it.each([
    ['null', null],
    ['absent', undefined],
    ['without a settings member', {}]
  ])('degrades a %s settings result to absent settings', async (_label, settingsResult) => {
    expect(await mount(settingsResult, UI_WITH_TRUST)).toEqual({
      runtimeSettings: null,
      trustedOrcaHooks: TRUSTED_HOOKS,
      availableProviders: ['github']
    })
  })

  // Same defect on the sibling leg: `reading 'ui'` threw after the settings commit and before
  // the provider commit.
  it.each([
    ['null', null],
    ['absent', undefined],
    ['without a ui member', {}]
  ])('degrades a %s ui result to untrusted hooks', async (_label, uiResult) => {
    expect(await mount({ settings: SETTINGS }, uiResult)).toEqual({
      runtimeSettings: SETTINGS,
      trustedOrcaHooks: {},
      availableProviders: ['github']
    })
  })

  it('publishes the settings and trust a host does send', async () => {
    expect(await mount({ settings: SETTINGS }, UI_WITH_TRUST)).toEqual({
      runtimeSettings: SETTINGS,
      trustedOrcaHooks: TRUSTED_HOOKS,
      availableProviders: ['github']
    })
  })
})
