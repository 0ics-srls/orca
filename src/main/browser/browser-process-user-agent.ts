import { app } from 'electron'
import type { BrowserSessionUserAgentMode } from '../../shared/browser-workspace-types'

export type BrowserProcessUserAgentIdentity = Readonly<{
  mode: BrowserSessionUserAgentMode
  /** What every document, frame and worker in this process presents. */
  userAgent: string
}>

let identity: BrowserProcessUserAgentIdentity | null = null

// Why: Electron's default includes its runtime and app tokens, which invalidate Chrome-imported sessions.
export function cleanElectronUserAgent(userAgent: string): string {
  return userAgent.replace(/\s+Electron\/\S+/, '').replace(/(\)\s+)\S+\s+(Chrome\/)/, '$1$2')
}

/**
 * Fix the whole process's browser identity before anything can read it.
 *
 * `app.userAgentFallback` is the one default every renderer, frame and worker inherits, so this
 * must land before `ready`: a session or WebContents created first keeps the old value, and
 * workers would then disagree with documents. `native` deliberately leaves the fallback alone
 * rather than assigning the raw string back, so the engine keeps its own untouched default.
 */
export function initializeBrowserProcessUserAgent(
  mode: BrowserSessionUserAgentMode
): BrowserProcessUserAgentIdentity {
  if (identity) {
    throw new Error('Browser process user agent was already initialized')
  }
  if (app.isReady()) {
    throw new Error('Browser process user agent must be initialized before Electron readiness')
  }
  if (mode === 'clean') {
    app.userAgentFallback = cleanElectronUserAgent(app.userAgentFallback)
  }
  identity = Object.freeze({ mode, userAgent: app.userAgentFallback })
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
