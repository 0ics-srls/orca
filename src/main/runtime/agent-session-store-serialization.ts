import type { AgentSessionStoreState } from './agent-session-record-store-file'

export function serializeAgentSessionStoreState(state: AgentSessionStoreState): string {
  const records: Record<string, unknown> = Object.create(null)
  for (const [sessionId, record] of state.records) {
    records[sessionId] = record
  }
  const serialized: Record<string, unknown> = {
    schemaVersion: state.schemaVersion,
    hostId: state.hostId,
    records,
    operations: Object.fromEntries(state.operations),
    retiredClaimKeys: state.retiredClaimKeys,
    unusableRecords: Object.fromEntries(state.unreadableRecords)
  }
  if (state.visibleSessionIdsIndexPresent) {
    serialized.visibleSessionIds = [...state.visibleSessionIds]
  }
  // Emitted only when present, so a profile that never recorded one keeps its existing bytes.
  if (state.resumeMarkers.size > 0) {
    serialized.resumeMarkers = Object.fromEntries(state.resumeMarkers)
  }
  return JSON.stringify(serialized)
}
