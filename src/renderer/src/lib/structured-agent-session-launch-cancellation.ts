import {
  hasStructuredAgentLaunchCancellationTombstonePersisted,
  markStructuredAgentLaunchCancelledPersisted,
  retireAbsentStructuredAgentLaunchCancellationTombstonesPersisted,
  retireStructuredAgentLaunchCancellationTombstonePersisted
} from './structured-agent-session-launch-persistence'

type CancellationRetirement = { retireAfterInventory: number | null }

const cancellationRetirementBySessionId = new Map<string, CancellationRetirement>()
let authoritativeInventorySequence = 0

export function resetStructuredAgentLaunchCancellationForTests(): void {
  cancellationRetirementBySessionId.clear()
  authoritativeInventorySequence = 0
}

/** Captured when an inventory request starts so a cancellation can reject older replies. */
export function beginStructuredAgentSessionAuthoritativeInventory(): number {
  authoritativeInventorySequence += 1
  return authoritativeInventorySequence
}

export function markStructuredAgentLaunchCancellation(
  sessionId: string,
  alreadyCancelled: boolean,
  launchPromise?: Promise<unknown>
): void {
  markStructuredAgentLaunchCancelledPersisted(sessionId)
  if (launchPromise) {
    const retirement: CancellationRetirement = { retireAfterInventory: null }
    cancellationRetirementBySessionId.set(sessionId, retirement)
    const armRetirement = (): void => {
      if (cancellationRetirementBySessionId.get(sessionId) === retirement) {
        // Inventories started before the create settled cannot prove that it will not publish.
        retirement.retireAfterInventory = authoritativeInventorySequence + 1
      }
    }
    void launchPromise.then(armRetirement, armRetirement)
  } else if (!alreadyCancelled) {
    // A restored tombstone has no live create left to settle; the next inventory can retire it.
    cancellationRetirementBySessionId.set(sessionId, {
      retireAfterInventory: authoritativeInventorySequence + 1
    })
  }
}

export function retireStructuredAgentLaunchCancellation(sessionId: string): void {
  retireStructuredAgentLaunchCancellationTombstonePersisted(sessionId)
  cancellationRetirementBySessionId.delete(sessionId)
}

export function retireAbsentStructuredAgentLaunchCancellations(
  publishedSessionIds: ReadonlySet<string>,
  authoritativeInventory: number
): boolean {
  const retainedSessionIds = new Set(publishedSessionIds)
  for (const [sessionId, retirement] of cancellationRetirementBySessionId) {
    if (
      retirement.retireAfterInventory === null ||
      authoritativeInventory < retirement.retireAfterInventory
    ) {
      retainedSessionIds.add(sessionId)
    }
  }
  const changed =
    retireAbsentStructuredAgentLaunchCancellationTombstonesPersisted(retainedSessionIds)
  if (changed) {
    for (const sessionId of cancellationRetirementBySessionId.keys()) {
      if (!hasStructuredAgentLaunchCancellationTombstonePersisted(sessionId)) {
        cancellationRetirementBySessionId.delete(sessionId)
      }
    }
  }
  return changed
}
