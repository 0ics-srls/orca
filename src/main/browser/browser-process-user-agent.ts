import { app } from 'electron'

export type BrowserProcessUserAgentIdentity = Readonly<{
  nativeUserAgent: string
  cleanUserAgent: string
}>

let identity: BrowserProcessUserAgentIdentity | null = null

// Why: Electron's default includes its runtime and app tokens, which invalidate Chrome-imported sessions.
export function cleanElectronUserAgent(userAgent: string): string {
  return userAgent.replace(/\s+Electron\/\S+/, '').replace(/(\)\s+)\S+\s+(Chrome\/)/, '$1$2')
}

export function initializeBrowserProcessUserAgent(): BrowserProcessUserAgentIdentity {
  if (identity) {
    throw new Error('Browser process user agent was already initialized')
  }
  if (app.isReady()) {
    throw new Error('Browser process user agent must be initialized before Electron readiness')
  }
  const nativeUserAgent = app.userAgentFallback
  const cleanUserAgent = cleanElectronUserAgent(nativeUserAgent)
  app.userAgentFallback = cleanUserAgent
  identity = Object.freeze({ nativeUserAgent, cleanUserAgent })
  return identity
}

export function getBrowserProcessUserAgentIdentity(): BrowserProcessUserAgentIdentity {
  if (!identity) {
    throw new Error('Browser process user agent is not initialized')
  }
  return identity
}

export function resetBrowserProcessUserAgentForTests(): void {
  identity = null
}

export function setBrowserProcessUserAgentIdentityForTests(
  nextIdentity: BrowserProcessUserAgentIdentity
): void {
  identity = Object.freeze({ ...nextIdentity })
}
