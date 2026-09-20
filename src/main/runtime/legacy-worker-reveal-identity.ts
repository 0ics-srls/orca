import type { TerminalRevealIdentity } from '../../shared/terminal-reveal-identity'

/**
 * Whether the renderer materialized the exact pane a legacy worker recovery asked for.
 *
 * Why no worktreeId: ownership is tab-keyed, so the renderer decides which workspace key the row
 * is filed under, and re-asserting the caller's key rolled back a reveal that had in fact
 * surfaced the right pane under a different one (STA-7961). The pane identity is still asserted.
 */
export function revealedLegacyWorkerIdentityMatches(
  identity: TerminalRevealIdentity | undefined,
  candidate: { tabId: string; leafId: string; ptyId: string }
): boolean {
  return Boolean(
    identity &&
    identity.tabId === candidate.tabId &&
    identity.leafId === candidate.leafId &&
    identity.ptyId === candidate.ptyId
  )
}
