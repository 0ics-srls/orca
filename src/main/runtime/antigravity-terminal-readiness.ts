import { isTerminalWaitWhitespace } from './terminal-wait-tail-window'

/**
 * Antigravity paints its chrome with cursor addressing, so model/account rows are not stable
 * line anchors. The idle composer is the only captured marker that survives every ready screen.
 */
export function findAntigravityReadyPromptIndex(normalized: string): number | null {
  return findAntigravityComposerIndex(normalized, true)
}

/** Visible-screen snapshots may omit the banner after a dialog closes. */
export function isAntigravityReadyPromptSnapshot(text: string): boolean {
  return findAntigravityComposerIndex(text.toLowerCase(), false) !== null
}

function isModelRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed === '>' || trimmed.includes('antigravity cli')) {
    return false
  }
  if (
    trimmed.includes('@') ||
    trimmed.includes('antigravity business') ||
    trimmed.includes('for shortcuts') ||
    trimmed.startsWith('~/') ||
    trimmed.startsWith('/') ||
    /^[a-z]:\\/i.test(trimmed)
  ) {
    return false
  }
  return true
}

function findAntigravityComposerIndex(normalized: string, requireHeader: boolean): number | null {
  const headerIndex = normalized.lastIndexOf('antigravity cli')
  const contentStart = headerIndex === -1 ? 0 : headerIndex
  if (requireHeader && headerIndex === -1) {
    return null
  }

  let offset = 0
  let composerStart: number | null = null
  let workspaceBeforeComposer = false
  let modelBeforeComposer = false
  let modelAfterComposer = false
  while (offset <= normalized.length) {
    const lineStart = offset
    const newlineIndex = normalized.indexOf('\n', lineStart)
    const lineEnd = newlineIndex === -1 ? normalized.length : newlineIndex
    let trimmedStart = lineStart
    let trimmedEnd = lineEnd
    while (trimmedStart < trimmedEnd && isTerminalWaitWhitespace(normalized, trimmedStart)) {
      trimmedStart += 1
    }
    while (trimmedEnd > trimmedStart && isTerminalWaitWhitespace(normalized, trimmedEnd - 1)) {
      trimmedEnd -= 1
    }
    if (trimmedStart >= contentStart && trimmedEnd - trimmedStart === 1) {
      if (normalized.charCodeAt(trimmedStart) === 62) {
        composerStart = trimmedStart
        modelAfterComposer = false
      }
    } else if (trimmedStart >= contentStart) {
      const value = normalized.slice(trimmedStart, trimmedEnd)
      const isWorkspace =
        value.startsWith('~/') || value.startsWith('/') || /^[a-z]:\\/i.test(value)
      if (composerStart === null) {
        workspaceBeforeComposer ||= isWorkspace
        modelBeforeComposer ||= isModelRow(value)
      } else {
        modelAfterComposer ||= isModelRow(value)
      }
    }
    offset = lineEnd + 1
    if (newlineIndex === -1) {
      break
    }
  }
  if (composerStart === null) {
    return null
  }
  // A trailing caret also appears on trust, sign-in, model, and onboarding menus. Those panes
  // must remain blocked until the menu is gone; only the latest AGY screen can establish readiness.
  if (
    /do you trust|sign in|select a model|collect usage|choose a theme|press enter to continue/.test(
      normalized.slice(contentStart)
    )
  ) {
    return null
  }
  if (!workspaceBeforeComposer) {
    return modelAfterComposer ? null : composerStart
  }
  return modelBeforeComposer || modelAfterComposer ? composerStart : null
}

export function hasAntigravityTerminalHeader(text: string): boolean {
  return text.toLowerCase().includes('antigravity cli')
}
