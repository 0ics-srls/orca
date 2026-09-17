import type { AgentJournalItemIdentity } from '../../shared/agent-session-journal-types'

/** Maximum sends awaiting an echo or exact owner-turn settlement. */
export const MAX_CODEX_PENDING_DISPATCH_ECHOES = 256

export type CodexDispatchRequestOrigin = {
  requestedAt: number
  sequence: number
}

type PendingDispatch = {
  requestedAt: number | null
  sequence: number
  /** A `turn/start` response is ownership evidence only after this turn starts. */
  startCandidateTurnId: string | null
  ownerTurnId: string | null
}

/**
 * Which sends this session is still waiting to hear back about, keyed by the
 * client message id Codex echoes on the user message.
 *
 * A successful `turn/steer` binds ownership atomically through expectedTurnId.
 * A fresh `turn/start` needs both its response id and matching started event;
 * either alone can describe a submission that never became the live turn.
 */
export type CodexDispatchEchoes = {
  /** Arms settlement for a send about to be written; false preserves older waits at capacity. */
  arm: (clientMessageId: string, requestedAt?: number) => boolean
  /** Records one successful steer response, binding only the expected active turn. */
  bindSteerResponse: (
    clientMessageId: string,
    expectedTurnId: string,
    responseTurnId: string
  ) => boolean
  /** Records the proposed owner returned by `turn/start`. */
  recordStartResponse: (clientMessageId: string, responseTurnId: string) => void
  /** Supplies the second half of fresh-turn ownership evidence. */
  observeTurnStarted: (turnId: string) => void
  /** True once, for a send this session armed and has not yet settled. */
  settle: (clientMessageId: string) => boolean
  /** Snapshots exact owners before a terminal lifecycle append. */
  terminalOwnerIds: (turnId: string) => string[]
  /** Retires the snapshot after the lifecycle append commits. */
  commitTerminal: (turnId: string) => void
  /** Releases a snapshot whose lifecycle append was discarded. */
  abandonTerminal: (turnId: string) => void
  /** Drops an armed send whose write never reached the provider. */
  disarm: (clientMessageId: string) => void
  /** Submission origin for this exact send, retained until its echo settles it. */
  requestOrigin: (clientMessageId: string) => CodexDispatchRequestOrigin | null
  /** Highest causal sequence assigned to a tracked dispatch in this session. */
  latestSequence: () => number
  clear: () => void
  readonly size: number
}

function rememberBounded(values: Set<string>, value: string): void {
  values.delete(value)
  values.add(value)
  while (values.size > MAX_CODEX_PENDING_DISPATCH_ECHOES) {
    const oldest = values.values().next().value
    if (oldest === undefined) {
      return
    }
    values.delete(oldest)
  }
}

export function createCodexDispatchEchoes(): CodexDispatchEchoes {
  const armed = new Map<string, PendingDispatch>()
  const retired = new Map<string, PendingDispatch>()
  const startedTurns = new Set<string>()
  const terminalTurns = new Set<string>()
  const terminalSnapshots = new Map<string, string[]>()
  let nextSequence = 0
  const rememberTerminalSnapshot = (turnId: string, snapshot: string[]): void => {
    terminalSnapshots.delete(turnId)
    terminalSnapshots.set(turnId, snapshot)
    while (terminalSnapshots.size > MAX_CODEX_PENDING_DISPATCH_ECHOES) {
      const oldest = terminalSnapshots.keys().next().value
      if (oldest === undefined) {
        return
      }
      terminalSnapshots.delete(oldest)
    }
  }
  const hasUnbound = (): boolean => {
    for (const pending of armed.values()) {
      if (pending.ownerTurnId === null) {
        return true
      }
    }
    return false
  }
  const pruneObservedTurns = (): void => {
    if (!hasUnbound()) {
      startedTurns.clear()
      terminalTurns.clear()
    }
  }
  const rememberRetired = (clientMessageId: string, pending: PendingDispatch): void => {
    retired.delete(clientMessageId)
    retired.set(clientMessageId, pending)
    while (retired.size > MAX_CODEX_PENDING_DISPATCH_ECHOES) {
      const oldest = retired.keys().next().value
      if (oldest === undefined) {
        return
      }
      retired.delete(oldest)
    }
  }
  const bindStartedCandidates = (turnId: string): void => {
    if (terminalTurns.has(turnId)) {
      return
    }
    for (const pending of armed.values()) {
      if (pending.startCandidateTurnId === turnId) {
        pending.ownerTurnId = turnId
      }
    }
  }

  return {
    arm(clientMessageId, requestedAt) {
      const existing = armed.get(clientMessageId)
      if (existing) {
        if (existing.requestedAt === null && requestedAt !== undefined) {
          existing.requestedAt = requestedAt
        }
        return true
      }
      if (armed.size >= MAX_CODEX_PENDING_DISPATCH_ECHOES) {
        return false
      }
      retired.delete(clientMessageId)
      armed.set(clientMessageId, {
        requestedAt: requestedAt ?? null,
        sequence: nextSequence++,
        startCandidateTurnId: null,
        ownerTurnId: null
      })
      return true
    },
    bindSteerResponse(clientMessageId, expectedTurnId, responseTurnId) {
      const pending = armed.get(clientMessageId)
      if (!pending || responseTurnId !== expectedTurnId || terminalTurns.has(expectedTurnId)) {
        return false
      }
      pending.ownerTurnId = expectedTurnId
      pending.startCandidateTurnId = null
      pruneObservedTurns()
      return true
    },
    recordStartResponse(clientMessageId, responseTurnId) {
      const pending = armed.get(clientMessageId)
      if (!pending) {
        return
      }
      pending.startCandidateTurnId = responseTurnId
      if (startedTurns.has(responseTurnId) && !terminalTurns.has(responseTurnId)) {
        pending.ownerTurnId = responseTurnId
      }
      pruneObservedTurns()
    },
    observeTurnStarted(turnId) {
      if (terminalTurns.has(turnId)) {
        return
      }
      rememberBounded(startedTurns, turnId)
      bindStartedCandidates(turnId)
      pruneObservedTurns()
    },
    settle(clientMessageId) {
      const settled = armed.delete(clientMessageId) || retired.delete(clientMessageId)
      pruneObservedTurns()
      return settled
    },
    terminalOwnerIds(turnId) {
      const priorSnapshot = terminalSnapshots.get(turnId)
      if (priorSnapshot) {
        return [...priorSnapshot]
      }
      const snapshot = [...armed].flatMap(([clientMessageId, pending]) =>
        pending.ownerTurnId === turnId ? [clientMessageId] : []
      )
      rememberBounded(terminalTurns, turnId)
      startedTurns.delete(turnId)
      if (snapshot.length > 0) {
        rememberTerminalSnapshot(turnId, snapshot)
      }
      return [...snapshot]
    },
    commitTerminal(turnId) {
      for (const clientMessageId of terminalSnapshots.get(turnId) ?? []) {
        const pending = armed.get(clientMessageId)
        if (pending?.ownerTurnId === turnId) {
          armed.delete(clientMessageId)
          rememberRetired(clientMessageId, pending)
        }
      }
      terminalSnapshots.delete(turnId)
      pruneObservedTurns()
    },
    abandonTerminal(turnId) {
      terminalSnapshots.delete(turnId)
      pruneObservedTurns()
    },
    disarm(clientMessageId) {
      armed.delete(clientMessageId)
      retired.delete(clientMessageId)
      pruneObservedTurns()
    },
    requestOrigin(clientMessageId) {
      const origin = armed.get(clientMessageId) ?? retired.get(clientMessageId)
      return origin?.requestedAt === null || origin === undefined
        ? null
        : { requestedAt: origin.requestedAt, sequence: origin.sequence }
    },
    latestSequence: () => nextSequence - 1,
    clear: () => {
      armed.clear()
      retired.clear()
      startedTurns.clear()
      terminalTurns.clear()
      terminalSnapshots.clear()
      nextSequence = 0
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
