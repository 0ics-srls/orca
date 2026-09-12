import { describe, expect, it, vi } from 'vitest'
import { googleAuthUserAgent } from './browser-google-auth-ua'
import { installBrowserSessionUserAgentExceptions } from './browser-session-ua'
import { setBrowserSessionUserAgentMode } from './browser-session-user-agent-mode'
import { buildViewportUserAgentOverride } from './browser-viewport-user-agent'

type RequestDetails = {
  url: string
  webContentsId?: number
  webContents?: { getUserAgent: () => string }
  referrer?: string
  resourceType?: string
  requestHeaders: Record<string, string>
}

type RequestListener = (
  details: RequestDetails,
  callback: (response: { requestHeaders: Record<string, string> }) => void
) => void

function install(
  resolveRequestUserAgent?: Parameters<typeof installBrowserSessionUserAgentExceptions>[1]
) {
  const onBeforeSendHeaders = vi.fn()
  const sess = {
    getUserAgent: vi.fn(
      () =>
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) orca/1.0.0 Chrome/134.0.0.0 Electron/30.0.0 Safari/537.36'
    ),
    webRequest: { onBeforeSendHeaders }
  }
  installBrowserSessionUserAgentExceptions(sess as never, resolveRequestUserAgent)
  return onBeforeSendHeaders.mock.calls[0][1] as RequestListener
}

function runRequest(listener: RequestListener, details: RequestDetails): Record<string, string> {
  const callback = vi.fn()
  listener(details, callback)
  return callback.mock.calls[0][0].requestHeaders
}

describe('browser session request identity', () => {
  it('returns an ordinary request with the exact header object and contents unchanged', () => {
    const onBeforeSendHeaders = vi.fn()
    const sess = { webRequest: { onBeforeSendHeaders } }
    const resolver = vi.fn(() => undefined)
    const dispose = installBrowserSessionUserAgentExceptions(sess as never, resolver)
    const listener = onBeforeSendHeaders.mock.calls[0][1] as RequestListener
    const requestHeaders = {
      'User-Agent': 'arbitrary incoming identity',
      'sec-ch-ua': 'browser-owned',
      Cookie: 'session=kept'
    }
    const callback = vi.fn()

    listener({ url: 'https://example.com/resource', requestHeaders }, callback)

    expect(callback).toHaveBeenCalledWith({ requestHeaders })
    expect(callback.mock.calls[0][0].requestHeaders).toBe(requestHeaders)
    expect(requestHeaders).toEqual({
      'User-Agent': 'arbitrary incoming identity',
      'sec-ch-ua': 'browser-owned',
      Cookie: 'session=kept'
    })
    dispose()
    dispose()
    expect(onBeforeSendHeaders).toHaveBeenLastCalledWith(null)
    expect(onBeforeSendHeaders).toHaveBeenCalledTimes(2)
  })

  it('does not treat an HTTP Google hostname as the HTTPS auth exception', () => {
    const requestHeaders = {
      'User-Agent': 'Chrome/134',
      'sec-ch-ua': 'browser-owned'
    }
    const result = runRequest(install(), {
      url: 'http://accounts.google.com/v3/signin/identifier',
      requestHeaders
    })

    expect(result).toBe(requestHeaders)
    expect(result).toEqual({
      'User-Agent': 'Chrome/134',
      'sec-ch-ua': 'browser-owned'
    })
  })

  it('keeps every native request untouched, including Google auth', () => {
    const onBeforeSendHeaders = vi.fn()
    const sess = { webRequest: { onBeforeSendHeaders } }
    setBrowserSessionUserAgentMode(sess as never, 'native')
    installBrowserSessionUserAgentExceptions(
      sess as never,
      vi.fn(() => ({ userAgent: 'wrong' }))
    )
    const listener = onBeforeSendHeaders.mock.calls[0][1] as RequestListener
    const requestHeaders = {
      'User-Agent': 'Orca/1 Chrome/134 Electron/30',
      'sec-ch-ua': 'browser-owned'
    }

    expect(
      runRequest(listener, {
        url: 'https://accounts.google.com/v3/signin/identifier',
        requestHeaders
      })
    ).toBe(requestHeaders)
    expect(requestHeaders['User-Agent']).toContain('Electron/')
    expect(requestHeaders['sec-ch-ua']).toBe('browser-owned')
  })

  it('ablates the resolver on a worker request while enforcing its mobile identity when enabled', () => {
    const mobileIdentity = buildViewportUserAgentOverride({
      url: 'https://example.com/worker-beacon',
      mobile: true,
      baseUserAgent: 'Chrome/134.0.0.0'
    })
    const request = {
      url: 'https://example.com/worker-beacon',
      requestHeaders: {
        'User-Agent': 'Electron/30 Chrome/134',
        'sec-ch-ua': 'desktop brands',
        'sec-ch-ua-full-version-list': 'desktop versions',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"15.0.0"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-model': '""',
        'sec-ch-ua-form-factors': '"Desktop"'
      }
    }

    // Ablation: with the exception resolver disabled, ordinary traffic remains untouched.
    const disabled = runRequest(install(), structuredClone(request))
    expect(disabled['User-Agent']).toBe('Electron/30 Chrome/134')
    expect(disabled['sec-ch-ua-platform']).toBe('"macOS"')

    const resolver = vi.fn(() => mobileIdentity)
    const enabled = runRequest(install(resolver), structuredClone(request))
    expect(enabled['User-Agent']).toBe(mobileIdentity.userAgent)
    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({ url: request.url, webContentsId: undefined })
    )
    expect(enabled['sec-ch-ua']).toContain('"Google Chrome";v="134"')
    expect(enabled['sec-ch-ua-full-version-list']).toContain('"Google Chrome";v="134.0.0.0"')
    expect(enabled['sec-ch-ua-platform']).toBe('"iOS"')
    expect(enabled['sec-ch-ua-platform-version']).toBe('"17.0"')
    expect(enabled['sec-ch-ua-mobile']).toBe('?1')
    expect(enabled['sec-ch-ua-model']).toBe('"iPhone"')
    expect(enabled['sec-ch-ua-form-factors']).toBeUndefined()
  })

  it('keeps Firefox across auth-document cross-host requests and strips its hints', () => {
    const listener = install(({ effectiveUserAgent }) =>
      effectiveUserAgent ? { userAgent: effectiveUserAgent } : undefined
    )
    const headers = runRequest(listener, {
      url: 'https://www.gstatic.com/_/signin/log',
      webContentsId: 7,
      requestHeaders: {
        'User-Agent': googleAuthUserAgent(),
        'sec-ch-ua': 'browser-owned',
        'sec-ch-ua-platform': '"macOS"'
      },
      webContents: { getUserAgent: () => googleAuthUserAgent() } as never
    })
    expect(headers['User-Agent']).toBe(googleAuthUserAgent())
    expect(headers['sec-ch-ua']).toBeUndefined()
    expect(headers['sec-ch-ua-platform']).toBeUndefined()
  })

  it('keeps the Firefox auth-host branch independent of the resolver', () => {
    const resolver = vi.fn(() => ({ userAgent: 'unexpected Chrome identity' }))
    const headers = runRequest(install(resolver), {
      url: 'https://accounts.google.com/v3/signin/identifier',
      requestHeaders: {
        'User-Agent': 'Chrome/134',
        'sec-ch-ua': 'browser-owned'
      }
    })
    expect(headers['User-Agent']).toBe(googleAuthUserAgent())
    expect(headers['sec-ch-ua']).toBeUndefined()
    expect(resolver).not.toHaveBeenCalled()
  })
})
