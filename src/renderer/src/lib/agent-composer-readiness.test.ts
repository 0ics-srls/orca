import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_COMPOSER_READINESS_RUNTIME_CAPABILITY as capability } from '../../../shared/protocol-version'
import type * as RuntimeRpcClient from '@/runtime/runtime-rpc-client'
import { waitForAgentComposerReady } from './agent-composer-readiness'

const leaf = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const mocks = vi.hoisted(() => {
  const state: {
    ptyIdsByTabId: Record<string, string[]>
    terminalLayoutsByTabId: Record<string, { ptyIdsByLeafId: Record<string, string> }>
  } = { ptyIdsByTabId: { tab: ['pty'] }, terminalLayoutsByTabId: {} }
  return {
    call: vi.fn(),
    capabilities: vi.fn(),
    remoteCapability: vi.fn(),
    state
  }
})
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/runtime/local-runtime-capabilities', () => ({
  ensureLocalRuntimeCapabilities: mocks.capabilities
}))
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeRpcClient>()
  return {
    ...actual,
    callRuntimeRpc: mocks.call,
    runtimeEnvironmentSupportsCapability: mocks.remoteCapability,
    getActiveRuntimeTarget: (settings?: { activeRuntimeEnvironmentId?: string }) =>
      settings?.activeRuntimeEnvironmentId
        ? { kind: 'environment', environmentId: settings.activeRuntimeEnvironmentId }
        : { kind: 'local' }
  }
})

const ready = {
  handle: 'term_test',
  source: 'screen',
  composerReady: true,
  status: 'running',
  exitCode: null
}

describe('Agent host-owned draft readiness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    mocks.state.ptyIdsByTabId = { tab: ['pty'] }
    mocks.state.terminalLayoutsByTabId = { tab: { ptyIdsByLeafId: { [leaf]: 'pty' } } }
    mocks.capabilities.mockReset().mockResolvedValue([capability])
    mocks.remoteCapability.mockReset().mockResolvedValue(true)
    mocks.call.mockReset().mockImplementation(async (_target, method) =>
      method === 'terminal.show'
        ? {
            terminal: {
              handle: 'term_test',
              ptyId: 'pty',
              connected: true,
              writable: true,
              agentIdentity: 'claude'
            }
          }
        : method === 'terminal.resolvePane'
          ? { terminal: { handle: 'term_test', tabId: 'tab', leafId: leaf, ptyId: 'pty' } }
          : { terminal: ready }
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits for the exact pane on its owning host', async () => {
    await expect(waitForAgentComposerReady('claude', 'tab', 'pty', 60000, null)).resolves.toBe(true)
    expect(mocks.call).toHaveBeenCalledWith(
      { kind: 'local' },
      'terminal.resolvePane',
      { paneKey: `tab:${leaf}` },
      expect.anything()
    )
    expect(mocks.call).toHaveBeenCalledWith(
      { kind: 'local' },
      'terminal.read',
      { terminal: 'term_test', screen: true },
      expect.anything()
    )
  })

  it('routes a paired PTY to its owner even when another host is selected', async () => {
    const pty = 'remote:host-b@@term_test'
    mocks.state.ptyIdsByTabId.tab = [pty]
    mocks.state.terminalLayoutsByTabId.tab = { ptyIdsByLeafId: { [leaf]: pty } }
    await expect(
      waitForAgentComposerReady('claude', 'tab', pty, 60000, {
        activeRuntimeEnvironmentId: 'host-a'
      })
    ).resolves.toBe(true)
    expect(mocks.remoteCapability).toHaveBeenCalledWith('host-b', capability, 5000)
    expect(mocks.call).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'host-b' },
      'terminal.read',
      { terminal: 'term_test', screen: true },
      expect.anything()
    )
    expect(mocks.capabilities).not.toHaveBeenCalled()
  })

  it('does not paste on old local or paired hosts', async () => {
    mocks.capabilities.mockResolvedValue([])
    mocks.remoteCapability.mockResolvedValue(false)
    await expect(waitForAgentComposerReady('claude', 'tab', 'pty', 60000, null)).resolves.toBe(
      false
    )
    await expect(
      waitForAgentComposerReady('claude', 'tab', 'pty', 60000, {
        activeRuntimeEnvironmentId: 'host-b'
      })
    ).resolves.toBe(false)
    expect(mocks.remoteCapability).toHaveBeenCalledWith('host-b', capability, 5000)
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it.each([{ status: 'exited' }, { handle: 'term_other' }])(
    'rejects an unusable wait verdict: %j',
    async (change) => {
      mocks.call.mockImplementation(async (_target, method) =>
        method === 'terminal.resolvePane'
          ? { terminal: { handle: 'term_test', ptyId: 'pty' } }
          : { terminal: { ...ready, ...change } }
      )
      await expect(waitForAgentComposerReady('claude', 'tab', 'pty', 60000, null)).resolves.toBe(
        false
      )
    }
  )

  it.each([false, undefined])(
    'holds a dialog until a positive composer answer (%s)',
    async (composerReady) => {
      const normal = mocks.call.getMockImplementation()!
      let released = false
      mocks.call.mockImplementation(async (target, method, params) =>
        method === 'terminal.read'
          ? { terminal: { ...ready, composerReady: released ? true : composerReady } }
          : normal(target, method, params)
      )
      const waiting = waitForAgentComposerReady('claude', 'tab', 'pty', 60000, null)
      let settled = false
      void waiting.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(2000)
      expect(settled).toBe(false)
      released = true
      await vi.advanceTimersByTimeAsync(250)
      await expect(waiting).resolves.toBe(true)
    }
  )

  it('rejects a different agent that took over the same PTY while waiting', async () => {
    mocks.call.mockImplementation(async (_target, method) =>
      method === 'terminal.read'
        ? { terminal: ready }
        : {
            terminal: {
              handle: 'term_test',
              ptyId: 'pty',
              connected: true,
              writable: true,
              agentIdentity: 'codex'
            }
          }
    )
    await expect(waitForAgentComposerReady('claude', 'tab', 'pty', 60000, null)).resolves.toBe(
      false
    )
  })

  it('rejects a new incarnation even if the tab keeps the same PTY id', async () => {
    const normal = mocks.call.getMockImplementation()!
    let incarnationId = 'original'
    mocks.call.mockImplementation(async (target, method, params) => {
      const result = await normal(target, method, params)
      if (method === 'terminal.resolvePane') {
        return { terminal: { ...result.terminal, incarnationId } }
      }
      if (method === 'terminal.read') {
        return { terminal: { ...ready, composerReady: incarnationId === 'replacement' } }
      }
      return result
    })
    const waiting = waitForAgentComposerReady('claude', 'tab', 'pty', 60000, null)
    await vi.advanceTimersByTimeAsync(1000)
    incarnationId = 'replacement'
    await vi.advanceTimersByTimeAsync(250)
    await expect(waiting).resolves.toBe(false)
  })

  it('bounds a local capability probe that never answers', async () => {
    mocks.capabilities.mockReturnValue(new Promise(() => {}))
    const waiting = waitForAgentComposerReady('claude', 'tab', 'pty', 1000, null)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(waiting).resolves.toBe(false)
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('keeps the identity check within the remaining readiness budget', async () => {
    await expect(waitForAgentComposerReady('claude', 'tab', 'pty', 1000, null)).resolves.toBe(true)
    expect(mocks.call).toHaveBeenCalledWith(
      { kind: 'local' },
      'terminal.show',
      { terminal: 'term_test' },
      { timeoutMs: 1000 }
    )
  })

  it('rejects loss of host contact', async () => {
    mocks.call.mockRejectedValue(new Error('transport disconnected'))
    await expect(waitForAgentComposerReady('claude', 'tab', 'pty', 60000, null)).resolves.toBe(
      false
    )
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })

  it('rejects a ready answer after the pane was replaced', async () => {
    mocks.call.mockImplementation(async (_target, method) => {
      if (method === 'terminal.resolvePane') {
        return { terminal: { handle: 'term_test', ptyId: 'pty' } }
      }
      mocks.state.ptyIdsByTabId.tab = ['replacement']
      return { terminal: ready }
    })
    await expect(waitForAgentComposerReady('claude', 'tab', 'pty', 60000, null)).resolves.toBe(
      false
    )
  })

  it('waits for publication of a newly bound pane without trusting the shell', async () => {
    mocks.call.mockRejectedValueOnce(new Error('terminal_not_found'))
    const waiting = waitForAgentComposerReady('claude', 'tab', 'pty', 60000, null)
    await vi.advanceTimersByTimeAsync(100)
    await expect(waiting).resolves.toBe(true)
    expect(mocks.call).toHaveBeenCalledTimes(4)
  })
})
