import type { AgentJournalItemIdentity } from '../../shared/agent-session-journal-types'

/** Maximum sends awaiting an echo or exact owner-turn settlement. */
export const MAX_CODEX_PENDING_DISPATCH_ECHOES = 256

/**
 * Which sends this session is still waiting to hear back about, keyed by the
 * client message id Codex echoes on the user message.
 *
 * Keyed rather than ordered on purpose: Codex coalesces a `turn/start` issued
 * while a turn is running into that turn, so two sends can share one turn id and
 * their echoes arrive far apart. The active lifecycle or start response binds
 * exact turn ownership.
 */
export type CodexDispatchEchoes = {
  /** Arms settlement for a send about to be written; false preserves older waits at capacity. */
  arm: (clientMessageId: string) => boolean
  /** Binds the accepted request to its owner turn; true means that turn already ended. */
  bindOwnerTurn: (clientMessageId: string, turnId: string) => boolean
  /** True once, for a send this session armed and has not yet settled. */
  settle: (clientMessageId: string) => boolean
  /** Exact still-unanswered sends owned by this turn. */
  pendingForTurn: (turnId: string) => string[]
  /** Retires live ownership while retaining a bounded late-echo correlation. */
  retireTurn: (turnId: string) => void
  /** Drops an armed send whose write never reached the provider. */
  disarm: (clientMessageId: string) => void
  clear: () => void
  readonly size: number
}

export function createCodexDispatchEchoes(): CodexDispatchEchoes {
  const armed = new Map<string, string | null>()
  const retired = new Set<string>()
  const terminalTurns = new Set<string>()
  const rememberRetired = (clientMessageId: string): void => {
    retired.delete(clientMessageId)
    retired.add(clientMessageId)
    while (retired.size > MAX_CODEX_PENDING_DISPATCH_ECHOES) {
      const oldest = retired.values().next().value
      if (oldest === undefined) {
        return
      }
      retired.delete(oldest)
    }
  }
  const hasUnbound = (): boolean => {
    for (const turnId of armed.values()) {
      if (turnId === null) {
        return true
      }
    }
    return false
  }
  const pruneTerminalTurns = (): void => {
    if (!hasUnbound()) {
      terminalTurns.clear()
    }
    while (terminalTurns.size > MAX_CODEX_PENDING_DISPATCH_ECHOES) {
      const oldest = terminalTurns.values().next().value
      if (oldest === undefined) {
        return
      }
      terminalTurns.delete(oldest)
    }
  }
  return {
    arm(clientMessageId) {
      if (!armed.has(clientMessageId) && armed.size >= MAX_CODEX_PENDING_DISPATCH_ECHOES) {
        return false
      }
      armed.delete(clientMessageId)
      retired.delete(clientMessageId)
      armed.set(clientMessageId, null)
      return true
    },
    bindOwnerTurn(clientMessageId, turnId) {
      if (!armed.has(clientMessageId)) {
        return false
      }
      if (terminalTurns.has(turnId)) {
        armed.delete(clientMessageId)
        rememberRetired(clientMessageId)
        pruneTerminalTurns()
        return true
      }
      armed.set(clientMessageId, turnId)
      pruneTerminalTurns()
      return false
    },
    settle(clientMessageId) {
      const settled = armed.delete(clientMessageId) || retired.delete(clientMessageId)
      pruneTerminalTurns()
      return settled
    },
    pendingForTurn: (turnId) =>
      [...armed].flatMap(([clientMessageId, ownerTurnId]) =>
        ownerTurnId === turnId ? [clientMessageId] : []
      ),
    retireTurn(turnId) {
      for (const [clientMessageId, ownerTurnId] of armed) {
        if (ownerTurnId === turnId) {
          armed.delete(clientMessageId)
          rememberRetired(clientMessageId)
        }
      }
      if (hasUnbound()) {
        terminalTurns.delete(turnId)
        terminalTurns.add(turnId)
      }
      pruneTerminalTurns()
    },
    disarm(clientMessageId) {
      armed.delete(clientMessageId)
      retired.delete(clientMessageId)
      pruneTerminalTurns()
    },
    clear: () => {
      armed.clear()
      retired.clear()
      terminalTurns.clear()
    },
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
