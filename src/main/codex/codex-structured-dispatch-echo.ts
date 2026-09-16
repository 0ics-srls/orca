import type { AgentJournalItemIdentity } from '../../shared/agent-session-journal-types'

/** Sends awaiting their echo, oldest first. A send whose echo never arrives is
 *  retired by the journal's pending-submission recovery on exit, not from here. */
export const MAX_CODEX_PENDING_DISPATCH_ECHOES = 256

/**
 * Which sends this session is still waiting to hear back about, keyed by the
 * client message id Codex echoes on the user message.
 *
 * Keyed rather than ordered on purpose: Codex coalesces a `turn/start` issued
 * while a turn is running into that turn, so two sends can share one turn id and
 * their echoes arrive far apart. Queue position identifies neither.
 */
export type CodexDispatchEchoes = {
  /** Arms settlement for a send about to be written; false preserves older waits at capacity. */
  arm: (clientMessageId: string, requestedAt?: number) => boolean
  /** True once, for a send this session armed and has not yet settled. */
  settle: (clientMessageId: string) => boolean
  /** Drops an armed send whose write never reached the provider. */
  disarm: (clientMessageId: string) => void
  /** Submission instant of the oldest send still awaiting its echo. A turn opening
   *  now is that send's: later ones were coalesced into turns already running, and
   *  the echo that retires this entry does not arrive until inside the new turn. */
  openingRequestedAt: () => number | null
  clear: () => void
  readonly size: number
}

export function createCodexDispatchEchoes(): CodexDispatchEchoes {
  const armed = new Map<string, number | null>()
  return {
    arm(clientMessageId, requestedAt) {
      if (!armed.has(clientMessageId) && armed.size >= MAX_CODEX_PENDING_DISPATCH_ECHOES) {
        return false
      }
      armed.delete(clientMessageId)
      armed.set(clientMessageId, requestedAt ?? null)
      return true
    },
    settle: (clientMessageId) => armed.delete(clientMessageId),
    disarm: (clientMessageId) => void armed.delete(clientMessageId),
    openingRequestedAt: () => armed.values().next().value ?? null,
    clear: () => armed.clear(),
    get size() {
      return armed.size
    }
  }
}

/** The user-message echo a settlement is read off, or null for any other item. */
export function readCodexDispatchEcho(
  item: { type: string; id: string } & Record<string, unknown>,
  identity: AgentJournalItemIdentity
): { clientMessageId: string; providerIdentity: AgentJournalItemIdentity } | null {
  if (item.type !== 'userMessage' || identity.provider !== 'codex') {
    return null
  }
  const clientMessageId = item.clientId
  return typeof clientMessageId === 'string' && clientMessageId.length > 0
    ? { clientMessageId, providerIdentity: identity }
    : null
}
