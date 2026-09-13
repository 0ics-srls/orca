// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handleDidAttach: vi.fn<() => Promise<boolean | null>>(),
  unsubscribeResume: vi.fn(),
  disposeRecovery: vi.fn()
}))

vi.mock('./browser-page-webview-guest-session', () => ({
  createBrowserPageWebviewGuestSession: () => ({
    guestRecovery: {
      confirmRegistration: vi.fn(),
      dispose: mocks.disposeRecovery,
      recoverRenderer: vi.fn(),
      retryRecovery: vi.fn(),
      validateAfterResume: vi.fn()
    },
    handleDidAttach: mocks.handleDidAttach,
    handleDomReady: vi.fn(),
    handleGuestDestroyed: vi.fn()
  })
}))

vi.mock('./browser-page-webview-loading-handlers', () => ({
  createBrowserPageWebviewLoadingHandlers: () => ({
    handleDidStartLoading: vi.fn(),
    handleDidStopLoading: vi.fn(),
    handleFailLoad: vi.fn()
  })
}))

vi.mock('./browser-page-webview-navigation-handlers', () => ({
  createBrowserPageWebviewNavigationHandlers: () => ({
    handleDidStartNavigation: vi.fn(),
    handleDidRedirectNavigation: vi.fn(),
    handleFullDidNavigate: vi.fn(),
    handleDidNavigateInPage: vi.fn(),
    handleTitleUpdate: vi.fn(),
    handleFaviconUpdate: vi.fn(),
    handleAnnotationViewportMessage: vi.fn()
  })
}))

vi.mock('./browser-system-resume', () => ({
  subscribeBrowserSystemResume: () => mocks.unsubscribeResume
}))

vi.mock('./browser-page-viewport', () => ({ parkBrowserPageViewport: vi.fn() }))
vi.mock('./webview-registry', () => ({
  isBrowserPageRendererRecoveryPending: () => false,
  moveFocusToRendererBeforeWebviewDetach: vi.fn()
}))

import { bindBrowserPageWebviewListeners } from './bind-browser-page-webview-listeners'

afterEach(() => {
  mocks.handleDidAttach.mockReset()
  mocks.unsubscribeResume.mockReset()
  mocks.disposeRecovery.mockReset()
})

describe('initial browser webview navigation', () => {
  it('waits for main to acknowledge guest identity before assigning the first URL', async () => {
    let acknowledge!: (registered: boolean) => void
    mocks.handleDidAttach.mockReturnValue(
      new Promise((resolve) => {
        acknowledge = resolve
      })
    )
    const container = document.createElement('div')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the DOM lib has no <webview> element type; Electron registers the tag at runtime and the binder reads only the listener members jsdom already provides.
    const webview = document.createElement('webview') as Electron.WebviewTag
    const webviewRef = { current: webview }
    const trackNextLoadingEventRef = { current: false }
    const lastKnownWebviewUrlRef: { current: string | null } = { current: null }
    const validateVisibleGuestRegistrationRef = { current: vi.fn() }
    const retryGuestRecoveryRef = { current: vi.fn() }
    const cleanup = bindBrowserPageWebviewListeners({
      container,
      webview,
      needsInitialNavigation: true,
      onContainerDragOver: vi.fn(),
      onContainerDrop: vi.fn(),
      dismissAddressBarSuggestions: vi.fn(),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial args double; bindBrowserPageWebviewListeners reads only the refs and handlers wired below, and a member it reached that is missing throws here rather than passing silently.
      args: {
        browserTabId: 'page-a',
        initialBrowserUrlRef: { current: 'example.com/path' },
        isPaintableRef: { current: true },
        webviewRef,
        trackNextLoadingEventRef,
        lastKnownWebviewUrlRef,
        validateVisibleGuestRegistrationRef,
        retryGuestRecoveryRef,
        setFindOpen: vi.fn()
      } as never
    })

    webview.dispatchEvent(new Event('did-attach'))
    expect(webview.src).toBeUndefined()
    expect(lastKnownWebviewUrlRef.current).toBeNull()

    acknowledge(true)
    await vi.waitFor(() => expect(webview.src).toBe('https://example.com/path'))
    expect(trackNextLoadingEventRef.current).toBe(true)
    expect(lastKnownWebviewUrlRef.current).toBe('https://example.com/path')

    cleanup()
  })
})
