import type { BrowserPageZoomDirection } from './browser-page-zoom'

/** The page a guest-forwarded chrome chord (reload, history, zoom, address bar) is aimed at. */
export type BrowserPageCommandTarget = {
  browserPageId: string
}

export type BrowserHistoryNavigateCommand = BrowserPageCommandTarget & {
  direction: 'back' | 'forward'
}

export type BrowserPageZoomCommand = BrowserPageCommandTarget & {
  direction: BrowserPageZoomDirection
}
