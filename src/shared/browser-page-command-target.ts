import type { BrowserPageZoomDirection } from './browser-page-zoom'

/** The page a guest-forwarded chrome chord (reload, history, zoom, address bar) is aimed at. */
export type BrowserPageCommandTarget = {
  browserPageId: string
}

export type BrowserHistoryDirection = 'back' | 'forward'

export type BrowserHistoryNavigateCommand = BrowserPageCommandTarget & {
  direction: BrowserHistoryDirection
}

export type BrowserPageZoomCommand = BrowserPageCommandTarget & {
  direction: BrowserPageZoomDirection
}

export function asBrowserPageCommandTarget(value: unknown): BrowserPageCommandTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  if (!('browserPageId' in value)) {
    return null
  }
  const { browserPageId } = value
  if (typeof browserPageId !== 'string' || browserPageId.length === 0) {
    return null
  }
  return { browserPageId }
}

function readDirection(value: unknown): unknown {
  return value && typeof value === 'object' && 'direction' in value ? value.direction : undefined
}

export function asBrowserHistoryNavigateCommand(
  value: unknown
): BrowserHistoryNavigateCommand | null {
  const target = asBrowserPageCommandTarget(value)
  const direction = readDirection(value)
  if (!target || (direction !== 'back' && direction !== 'forward')) {
    return null
  }
  return { browserPageId: target.browserPageId, direction }
}

export function asBrowserPageZoomCommand(value: unknown): BrowserPageZoomCommand | null {
  const target = asBrowserPageCommandTarget(value)
  const direction = readDirection(value)
  if (!target || (direction !== 'in' && direction !== 'out' && direction !== 'reset')) {
    return null
  }
  return { browserPageId: target.browserPageId, direction }
}
