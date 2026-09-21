import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pasteDraftToAgentPtyWhenReady, pasteDraftWhenAgentReady } from './agent-paste-draft'

const testState = vi.hoisted(() => {
  const ptyIdsByTabId: Record<string, string[]> = {}
  return {
    appState: { settings: {}, ptyIdsByTabId, tabsByWorktree: {} },
    storeSubscribers: new Set<(state: { ptyIdsByTabId: Record<string, string[]> }) => void>(),
    composerReady: vi.fn(),
    sendRuntimePtyInputVerified: vi.fn(),
    inspectRuntimeTerminalProcess: vi.fn()
  }
})

vi.mock('./agent-composer-readiness', () => ({
  waitForAgentComposerReady: testState.composerReady
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => testState.appState,
    subscribe: (
      subscriber: (state: { ptyIdsByTabId: Record<string, string[]> }) => void
    ): (() => void) => {
      testState.storeSubscribers.add(subscriber)
      return () => testState.storeSubscribers.delete(subscriber)
    }
  }
}))

vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  isRemoteRuntimePtyId: () => false,
  sendRuntimePtyInputVerified: testState.sendRuntimePtyInputVerified,
  inspectRuntimeTerminalProcess: testState.inspectRuntimeTerminalProcess
}))

const ISSUE_URL = 'https://github.com/stablyai/orca/issues/123'
const PASTED_ISSUE_URL = `\x1b[200~${ISSUE_URL}\x1b[201~`

describe('host-composer draft delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    })
    testState.composerReady.mockReset().mockResolvedValue(false)
    testState.appState.settings = {}
    testState.appState.ptyIdsByTabId = { 'tab-1': ['pty-1'] }
    testState.storeSubscribers.clear()
    testState.sendRuntimePtyInputVerified.mockReset()
    testState.sendRuntimePtyInputVerified.mockResolvedValue(true)
    testState.inspectRuntimeTerminalProcess.mockReset()
    testState.inspectRuntimeTerminalProcess.mockResolvedValue({
      foregroundProcess: 'bash',
      hasChildProcesses: false
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('retains a Claude continuation through slow Windows PTY binding', async () => {
    testState.appState.ptyIdsByTabId = {}
    testState.composerReady.mockResolvedValue(true)
    const waiting = pasteDraftWhenAgentReady({
      tabId: 'tab-1',
      agent: 'claude',
      forcePaste: true,
      content: ISSUE_URL
    })
    await vi.advanceTimersByTimeAsync(8307)
    expect(testState.sendRuntimePtyInputVerified).not.toHaveBeenCalled()
    testState.appState.ptyIdsByTabId = { 'tab-1': ['pty-1'] }
    for (const subscriber of testState.storeSubscribers) {
      subscriber(testState.appState)
    }
    await expect(waiting).resolves.toBe(true)
    expect(testState.sendRuntimePtyInputVerified).toHaveBeenCalledWith(
      {},
      'pty-1',
      PASTED_ISSUE_URL
    )
  })

  it('refuses explicit-PTY delivery when host readiness times out', async () => {
    testState.inspectRuntimeTerminalProcess.mockResolvedValue({ foregroundProcess: 'claude' })
    const onTimeout = vi.fn()
    await expect(
      pasteDraftToAgentPtyWhenReady({
        tabId: 'tab-1',
        ptyId: 'pty-1',
        agent: 'claude',
        forcePaste: true,
        submit: true,
        content: ISSUE_URL,
        onTimeout
      })
    ).resolves.toBe(false)
    expect(testState.sendRuntimePtyInputVerified).not.toHaveBeenCalled()
    expect(testState.inspectRuntimeTerminalProcess).not.toHaveBeenCalled()
    expect(onTimeout).toHaveBeenCalledOnce()
  })

  it('rechecks composer readiness after acquiring the paste transaction', async () => {
    testState.composerReady.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(
      pasteDraftToAgentPtyWhenReady({
        tabId: 'tab-1',
        ptyId: 'pty-1',
        agent: 'claude',
        forcePaste: true,
        submit: true,
        content: ISSUE_URL
      })
    ).resolves.toBe(false)
    expect(testState.sendRuntimePtyInputVerified).not.toHaveBeenCalled()
  })
})
