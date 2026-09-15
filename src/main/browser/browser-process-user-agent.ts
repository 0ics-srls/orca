import { app } from 'electron'
import type { BrowserUserAgentMode } from '../../shared/browser-user-agent-mode'

export type BrowserProcessUserAgentIdentity = Readonly<{
  mode: BrowserUserAgentMode
  /** What every document, frame and worker in this process presents. */
  userAgent: string
}>

let identity: BrowserProcessUserAgentIdentity | null = null

// Why: Electron's default includes its runtime and app tokens, which invalidate Chrome-imported sessions.
// Why anchored on the engine comment rather than a token shape: app.setName decides the app token
// and dev uses a name containing a space, which a single \S+ cannot span — it left "Orca Dev/x.y"
// on the wire. Anchoring on "(KHTML, like Gecko)" and consuming lazily up to Chrome/ removes any
// number of app tokens, and a user agent without that comment is returned unchanged rather than
// mangled.
export function cleanElectronUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s+Electron\/\S+/, '')
    .replace(/(\(KHTML, like Gecko\)\s+)(?:\S+(?:\s+\S+)*?\s+)?(Chrome\/)/, '$1$2')
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
  mode: BrowserUserAgentMode
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
