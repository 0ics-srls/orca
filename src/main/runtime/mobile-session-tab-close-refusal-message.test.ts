import { expect, it } from 'vitest'
import { describeMobileSessionTabCloseRefusal } from './mobile-session-tab-close-refusal-message'

const REASONS = [
  'missing-intent',
  'stale-publication',
  'stale-terminal',
  'live-host-pty',
  'unknown-liveness',
  'retirement-owner'
] as const

it.each(REASONS)('describes %s as a sentence, not an enum', (reason) => {
  const message = describeMobileSessionTabCloseRefusal(reason)
  expect(message).not.toContain(reason)
  expect(message).toMatch(/^[A-Z].*\.$/)
})

it('falls back for a missing reason and for a reason only a newer host knows', () => {
  const fallback = 'The host declined to close this terminal tab, so the tab was kept open.'
  expect(describeMobileSessionTabCloseRefusal(undefined)).toBe(fallback)
  // Why: remote wire skew — a newer host may answer with a reason this build has no text for.
  expect(describeMobileSessionTabCloseRefusal('reason-from-the-future' as never)).toBe(fallback)
})

it('avoids the substrings the Sleep-workspace toast reclassifies as an unreachable host', () => {
  for (const reason of [...REASONS, undefined]) {
    const message = describeMobileSessionTabCloseRefusal(reason)
    for (const misleading of ['legacy', 'terminal_', 'runtime', 'connection', 'Daemon']) {
      expect(message).not.toContain(misleading)
    }
  }
})
