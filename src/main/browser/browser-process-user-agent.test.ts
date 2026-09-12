import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronApp = vi.hoisted(() => ({
  isReady: vi.fn(() => false),
  userAgentFallback:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) orca/1.3.8-rc.0 Chrome/134.0.0.0 Electron/30.0.0 Safari/537.36'
}))

vi.mock('electron', () => ({ app: electronApp }))

import {
  cleanElectronUserAgent,
  getBrowserProcessUserAgentIdentity,
  initializeBrowserProcessUserAgent,
  resetBrowserProcessUserAgentForTests
} from './browser-process-user-agent'

const NATIVE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) orca/1.3.8-rc.0 Chrome/134.0.0.0 Electron/30.0.0 Safari/537.36'
const CLEAN_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'

describe('browser process user agent', () => {
  beforeEach(() => {
    resetBrowserProcessUserAgentForTests()
    electronApp.isReady.mockReturnValue(false)
    electronApp.userAgentFallback = NATIVE_USER_AGENT
  })

  it('captures the raw identity and assigns the cleaned process fallback once', () => {
    const result = initializeBrowserProcessUserAgent()

    expect(result).toEqual({
      nativeUserAgent: NATIVE_USER_AGENT,
      cleanUserAgent: CLEAN_USER_AGENT
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(electronApp.userAgentFallback).toBe(CLEAN_USER_AGENT)
    expect(getBrowserProcessUserAgentIdentity()).toBe(result)
    expect(() => initializeBrowserProcessUserAgent()).toThrow('already initialized')
  })

  it('refuses initialization after Electron readiness', () => {
    electronApp.isReady.mockReturnValue(true)

    expect(() => initializeBrowserProcessUserAgent()).toThrow('before Electron readiness')
    expect(electronApp.userAgentFallback).toBe(NATIVE_USER_AGENT)
  })

  it('removes only the Electron and app tokens', () => {
    expect(cleanElectronUserAgent(NATIVE_USER_AGENT)).toBe(CLEAN_USER_AGENT)
  })
})
