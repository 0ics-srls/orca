import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pasteDraftToAgentPtyWhenReady, pasteDraftWhenAgentReady } from './agent-paste-draft'

const mocks = vi.hoisted(() => {
  const state: {
    settings: object
    ptyIdsByTabId: Record<string, string[]>
    tabsByWorktree: object
  } = {
    settings: {},
    ptyIdsByTabId: { tab: ['pty'] },
    tabsByWorktree: {}
  }
  return {
    state,
    subscribers: new Set<(snapshot: typeof state) => void>(),
    hostReady: vi.fn(),
    shellReady: vi.fn(),
    inspect: vi.fn(),
    send: vi.fn(),
    processReady: vi.fn()
  }
})
vi.mock('./antigravity-draft-readiness', () => ({ waitForAntigravityDraftReady: mocks.hostReady }))
vi.mock('./agent-draft-readiness', () => ({ waitForAgentDraftInputReady: mocks.shellReady }))
vi.mock('./agent-ready-wait', () => ({ waitForAgentReady: mocks.processReady }))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mocks.state,
    subscribe: (listener: (state: typeof mocks.state) => void) => {
      mocks.subscribers.add(listener)
      return () => mocks.subscribers.delete(listener)
    }
  }
}))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimePtyInputVerified: mocks.send,
  inspectRuntimeTerminalProcess: mocks.inspect
}))

describe('Antigravity continuation delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    mocks.state.ptyIdsByTabId = { tab: ['pty'] }
    mocks.subscribers.clear()
    mocks.hostReady.mockReset()
    mocks.shellReady
      .mockReset()
      .mockImplementation(
        () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1500))
      )
    mocks.processReady.mockReset().mockResolvedValue({ ready: true })
    mocks.inspect
      .mockReset()
      .mockResolvedValue({ foregroundProcess: 'agy', hasChildProcesses: true })
    mocks.send.mockReset().mockResolvedValue(true)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retains the handoff when Windows binds the PTY after eight seconds', async () => {
    mocks.state.ptyIdsByTabId = { tab: [] }
    mocks.hostReady.mockResolvedValue(true)
    const onTimeout = vi.fn()
    const waiting = pasteDraftWhenAgentReady({
      tabId: 'tab',
      agent: 'antigravity',
      content: 'late Windows handoff',
      submit: true,
      forcePaste: true,
      onTimeout
    })
    await vi.advanceTimersByTimeAsync(8307)
    expect(mocks.send).not.toHaveBeenCalled()
    mocks.state.ptyIdsByTabId.tab = ['pty']
    for (const listener of mocks.subscribers) {
      listener(mocks.state)
    }
    await vi.advanceTimersByTimeAsync(100)
    await expect(waiting).resolves.toBe(true)
    expect(onTimeout).not.toHaveBeenCalled()
    expect(mocks.hostReady).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenLastCalledWith({}, 'pty', '\r')
    expect(mocks.subscribers.size).toBe(0)
  })

  it.each([
    { agent: 'antigravity', timeoutMs: 60000 },
    { agent: 'claude', timeoutMs: 8000 }
  ] as const)(
    'bounds missing-PTY waits for $agent at $timeoutMs ms',
    async ({ agent, timeoutMs }) => {
      mocks.state.ptyIdsByTabId = { tab: [] }
      const onTimeout = vi.fn()
      const waiting = pasteDraftWhenAgentReady({
        tabId: 'tab',
        agent,
        content: 'unsent handoff',
        forcePaste: true,
        onTimeout
      })
      await vi.advanceTimersByTimeAsync(timeoutMs)
      await expect(waiting).resolves.toBe(false)
      expect(onTimeout).toHaveBeenCalledOnce()
      expect(mocks.hostReady).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()
      expect(mocks.subscribers.size).toBe(0)
    }
  )

  it('leaves context unwritten through a quiet shell until the host confirms the composer', async () => {
    mocks.hostReady.mockImplementation(
      () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 12000))
    )
    const waiting = pasteDraftWhenAgentReady({
      tabId: 'tab',
      agent: 'antigravity',
      content: 'continue context',
      submit: true,
      forcePaste: true
    })
    await vi.advanceTimersByTimeAsync(10000)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.shellReady).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2100)
    await expect(waiting).resolves.toBe(true)
    expect(mocks.hostReady).toHaveBeenCalledWith('tab', 'pty', 60000, {})
    expect(mocks.send).toHaveBeenLastCalledWith({}, 'pty', '\r')
  })

  it.each(['tab', 'pty'] as const)('rejects process-only fallback on the %s path', async (path) => {
    mocks.hostReady.mockResolvedValue(false)
    const onTimeout = vi.fn()
    const args = {
      tabId: 'tab',
      ptyId: 'pty',
      agent: 'antigravity' as const,
      content: 'preserve context',
      submit: true,
      forcePaste: true,
      onTimeout
    }
    const waiting =
      path === 'tab' ? pasteDraftWhenAgentReady(args) : pasteDraftToAgentPtyWhenReady(args)
    await expect(waiting).resolves.toBe(false)
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(mocks.processReady).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
