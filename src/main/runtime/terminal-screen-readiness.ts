import { isAntigravityCommandApprovalScreen } from './antigravity-command-approval-screen'
import {
  detectTerminalWaitBlockedReason,
  isKnownReadyPromptPreview
} from './terminal-wait-detection'
import type { RuntimeTerminalWaitBlockedReason } from '../../shared/runtime-types'

const ANTIGRAVITY_FRAME = /^─{8,}$/
const ANTIGRAVITY_EMPTY_COMPOSERS = new Set([
  '>',
  '> Plan mode: research & plan only (shift+tab to cycle)',
  '> Accept-edits mode: file edits auto-approved (shift+tab to cycle)'
])

export function isKnownReadyTerminalScreen(screen: { tail: string[]; draft?: string }): boolean {
  if (screen.draft?.trim()) {
    return false
  }
  const text = screen.tail.join('\n')
  if (!text.toLowerCase().includes('antigravity cli')) {
    return isKnownReadyPromptPreview(text)
  }
  const rows = screen.tail.map((row) => row.trim()).filter(Boolean)
  const footer = rows.at(-1) ?? ''
  // The shortcut footer disappears for typed drafts and changes to cancel while working.
  return (
    footer.startsWith('? for shortcuts') &&
    ANTIGRAVITY_FRAME.test(rows.at(-2) ?? '') &&
    ANTIGRAVITY_EMPTY_COMPOSERS.has(rows.at(-3) ?? '') &&
    ANTIGRAVITY_FRAME.test(rows.at(-4) ?? '')
  )
}

export type TerminalScreenReadiness = {
  ready: boolean
  blockedReason: RuntimeTerminalWaitBlockedReason | null
}

export type ReadTerminalScreenReadiness = (
  ptyId: string | null | undefined,
  retainedText: string
) => TerminalScreenReadiness | null

export function classifyTerminalScreenReadiness(screen: {
  tail: string[]
  draft?: string
}): TerminalScreenReadiness {
  const ready = isKnownReadyTerminalScreen(screen)
  return {
    ready,
    blockedReason: ready
      ? null
      : isAntigravityCommandApprovalScreen(screen.tail)
        ? 'agent-approval-prompt'
        : detectTerminalWaitBlockedReason(screen.tail.join('\n'))
  }
}

/** Captured foreground generation and Windows background-task layouts. */
export function isAntigravityWorkingTerminalScreen(tail: readonly string[]): boolean {
  const rows = tail.map((row) => row.trim()).filter(Boolean)
  const footer = rows.at(-1) ?? ''
  const composerAt = (offset: number): boolean =>
    ANTIGRAVITY_FRAME.test(rows.at(offset) ?? '') &&
    ANTIGRAVITY_EMPTY_COMPOSERS.has(rows.at(offset - 1) ?? '') &&
    ANTIGRAVITY_FRAME.test(rows.at(offset - 2) ?? '')
  return (
    (footer.startsWith('esc to cancel') && composerAt(-2)) ||
    (footer.startsWith('? for shortcuts') &&
      /· [1-9]\d* task\(s\) · \/tasks$/.test(footer) &&
      ANTIGRAVITY_FRAME.test(rows.at(-2) ?? '') &&
      /^● \[\d{2}:\d{2}:\d{2}\] .+ running$/.test(rows.at(-3) ?? '') &&
      composerAt(-4))
  )
}
