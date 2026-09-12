import type { Session } from 'electron'
import type { ViewportUserAgentOverride } from './browser-viewport-user-agent'
export { cleanElectronUserAgent } from './browser-process-user-agent'
import { getBrowserSessionUserAgentMode } from './browser-session-user-agent-mode'

import {
  currentUserAgent,
  googleAuthUserAgent,
  setUserAgentHeader,
  shouldUseGoogleAuthIdentity,
  stripClientHints
} from './browser-google-auth-ua'

export type BrowserSessionRequestUserAgentResolver = (args: {
  session: Session
  url: string
  referrer?: string
  resourceType?: string
  webContentsId?: number
  currentUserAgent?: string
  effectiveUserAgent?: string
  baseUserAgent?: string
}) => ViewportUserAgentOverride | undefined

function quoteClientHint(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`
}

function formatClientHintBrands(brands: { brand: string; version: string }[]): string {
  return brands
    .map(({ brand, version }) => `${quoteClientHint(brand)};v=${quoteClientHint(version)}`)
    .join(', ')
}

function applyUserAgentMetadataHeaders(
  headers: Record<string, string>,
  metadata: NonNullable<ViewportUserAgentOverride['userAgentMetadata']>
): void {
  const values: Record<string, string> = {
    'sec-ch-ua': formatClientHintBrands(metadata.brands),
    'sec-ch-ua-full-version-list': formatClientHintBrands(metadata.fullVersionList),
    'sec-ch-ua-full-version': quoteClientHint(metadata.fullVersion),
    'sec-ch-ua-platform': quoteClientHint(metadata.platform),
    'sec-ch-ua-platform-version': quoteClientHint(metadata.platformVersion),
    'sec-ch-ua-arch': quoteClientHint(metadata.architecture),
    'sec-ch-ua-model': quoteClientHint(metadata.model),
    'sec-ch-ua-mobile': metadata.mobile ? '?1' : '?0'
  }
  for (const key of Object.keys(headers)) {
    const lowerKey = key.toLowerCase()
    if (!lowerKey.startsWith('sec-ch-ua')) {
      continue
    }
    const value = values[lowerKey]
    if (value === undefined) {
      delete headers[key]
    } else {
      headers[key] = value
    }
  }
}

// Desktop client hints remain browser-owned. Mobile overrides carry the same metadata CDP used,
// so worker requests can replace only hints Chromium already chose to emit without inventing them.
export function installBrowserSessionUserAgentExceptions(
  sess: Session,
  resolveRequestUserAgent?: BrowserSessionRequestUserAgentResolver
): () => void {
  const firefoxUa = googleAuthUserAgent()
  sess.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const headers = details.requestHeaders
      if (getBrowserSessionUserAgentMode(sess) === 'native') {
        callback({ requestHeaders: headers })
        return
      }
      const requestUserAgent = currentUserAgent(headers)
      let effectiveUserAgent: string | undefined
      try {
        effectiveUserAgent = details.webContents?.getUserAgent()
      } catch {
        // The request can race guest teardown; the header and manager state still provide a fallback.
      }
      if (shouldUseGoogleAuthIdentity(details.url, details.referrer, details.resourceType)) {
        // Why: present a Firefox identity on Google's sign-in hosts so the user logs
        // in inside the app and Google issues self-refreshing bound cookies. Auth-page
        // subresources share that identity even before the WebContents override lands.
        setUserAgentHeader(headers, firefoxUa)
        stripClientHints(headers)
        callback({ requestHeaders: headers })
        return
      }
      const identity = resolveRequestUserAgent?.({
        session: sess,
        url: details.url,
        referrer: details.referrer,
        resourceType: details.resourceType,
        webContentsId: details.webContentsId,
        currentUserAgent: requestUserAgent,
        effectiveUserAgent
      })
      if (!identity) {
        callback({ requestHeaders: headers })
        return
      }
      if (identity.userAgent) {
        setUserAgentHeader(headers, identity.userAgent)
      }
      if (identity.userAgent === firefoxUa) {
        // Why: while the auth document is on screen the WebContents UA is Firefox,
        // so its cross-host subresource/XHR requests (gstatic, play.google.com, the
        // sign-in challenge endpoints) reach here carrying the Firefox UA yet still
        // bearing Chromium client hints. Rewriting those to Chrome pairs a Firefox
        // UA with Chrome hints — a sharper cross-host identity tell than either
        // alone, which can stall Google's password-submit challenge. Real Firefox
        // sends no client hints, so strip them to keep one identity for the flow.
        stripClientHints(headers)
        callback({ requestHeaders: headers })
        return
      }
      if (identity.userAgentMetadata) {
        applyUserAgentMetadataHeaders(headers, identity.userAgentMetadata)
      }
      callback({ requestHeaders: headers })
    }
  )
  let disposed = false
  return (): void => {
    if (disposed) {
      return
    }
    disposed = true
    sess.webRequest.onBeforeSendHeaders(null)
  }
}
