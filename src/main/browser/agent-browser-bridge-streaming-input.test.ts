import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

const { execFileMock, webContentsFromIdMock, existsSyncMock, readFileSyncMock, stdinWrites } =
  vi.hoisted(() => ({
    execFileMock: vi.fn(),
    webContentsFromIdMock: vi.fn(),
    existsSyncMock: vi.fn(() => false),
    readFileSyncMock: vi.fn(() => Buffer.from('')),
    stdinWrites: new Array<string>()
  }))

vi.mock('child_process', () => ({ execFile: execFileMock }))
vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
  accessSync: vi.fn(),
  chmodSync: vi.fn(),
  constants: { X_OK: 1 }
}))
vi.mock('os', () => ({ platform: () => 'darwin', arch: () => 'arm64' }))
vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn(() => '/app'),
      getAppPath: vi.fn(() => '/project'),
      isPackaged: false
    },
    webContents: { fromId: webContentsFromIdMock }
  }
})
const { CdpWsProxyMock } = vi.hoisted(() => {
  const instances: unknown[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockClass = vi.fn().mockImplementation(function (this: any, _wc: unknown) {
    this._wc = _wc
    this.start = vi.fn(async () => 'ws://127.0.0.1:9222')
    this.stop = vi.fn(async () => {})
    this.getPort = vi.fn(() => 9222)
    instances.push(this)
  })
  return { CdpWsProxyMock: Object.assign(MockClass, { instances }) }
})

vi.mock('./cdp-ws-proxy', () => ({
  CdpWsProxy: CdpWsProxyMock
}))
vi.mock('./cdp-bridge', () => ({
  BrowserError: class BrowserError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
}))

import { AgentBrowserBridge } from './agent-browser-bridge'
import { markBrowserGuestStreaming } from './browser-screencast-streaming-guests'
import {
  mockBrowserManager,
  mockWebContents,
  overrideBridgeWebContentsLookup,
  resetAgentBrowserBridgeMocks
} from './agent-browser-bridge-test-harness'

overrideBridgeWebContentsLookup(AgentBrowserBridge.prototype, webContentsFromIdMock)

describe('AgentBrowserBridge input to a streamed guest', () => {
  let bridge: AgentBrowserBridge
  let acquireAutomationVisibility: Mock<(webContentsId: number) => Promise<() => void>>

  beforeEach(() => {
    resetAgentBrowserBridgeMocks({
      webContentsFromIdMock,
      existsSyncMock,
      readFileSyncMock,
      stdinWrites,
      cdpWsProxyInstances: CdpWsProxyMock.instances
    })
    acquireAutomationVisibility = vi.fn(async () => () => {})
    bridge = new AgentBrowserBridge(
      mockBrowserManager(undefined, undefined, { acquireAutomationVisibility })
    )
    bridge.setActiveTab(100)
    const wc = mockWebContents(100)
    wc.debugger.sendCommand.mockResolvedValue({})
    webContentsFromIdMock.mockReturnValue(wc)
  })

  it('skips the desktop visibility lease while the guest is streaming', async () => {
    const release = markBrowserGuestStreaming(100)
    try {
      await bridge.mouseMove(10, 20)
      await bridge.mouseWheel(120)
      await bridge.mouseClick(10, 20)
    } finally {
      release()
    }
    expect(acquireAutomationVisibility).not.toHaveBeenCalled()
  })

  it('leases visibility again once the stream ends', async () => {
    const release = markBrowserGuestStreaming(100)
    const releaseSecond = markBrowserGuestStreaming(100)
    release()
    await bridge.mouseMove(10, 20)
    expect(acquireAutomationVisibility).not.toHaveBeenCalled()

    releaseSecond()
    releaseSecond()
    await bridge.mouseMove(10, 20)
    expect(acquireAutomationVisibility).toHaveBeenCalledWith(100)
  })
})
