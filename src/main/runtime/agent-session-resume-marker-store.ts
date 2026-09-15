// Resume-marker reads and writes, kept off the record store class so that surface stays within its
// size budget. Built straight on the transaction queue, so a marker write is the same whole-file
// atomic commit every other durable session fact gets.

import {
  isExpiredAgentSessionResumeMarker,
  type AgentSessionResumeMarker
} from '../../shared/agent-session-resume-marker'
import type { AgentSessionStoreTransactionQueue } from './agent-session-store-transaction-queue'

export type AgentSessionResumeMarkerStore = {
  list: (now: number) => AgentSessionResumeMarker[]
  record: (markers: readonly AgentSessionResumeMarker[], now: number) => Promise<void>
  consume: (sessionId: string) => Promise<boolean>
}

export function createAgentSessionResumeMarkerStore(
  queue: AgentSessionStoreTransactionQueue
): AgentSessionResumeMarkerStore {
  return {
    // Expired markers are filtered on READ as well as on write: reporting one must never depend on
    // a prune having already run.
    list: (now) =>
      [...queue.state.resumeMarkers.values()].filter(
        (marker) => !isExpiredAgentSessionResumeMarker(marker, now)
      ),
    // Replaces the whole set: quit records every working session at once, so anything still here
    // from an earlier generation is stale by definition.
    record: (markers, now) =>
      queue.transact(() => {
        queue.state.resumeMarkers = new Map(
          markers
            .filter((marker) => !isExpiredAgentSessionResumeMarker(marker, now))
            .map((marker) => [marker.sessionId, marker])
        )
      }),
    consume: (sessionId) => queue.transact(() => queue.state.resumeMarkers.delete(sessionId))
  }
}
