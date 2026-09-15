// Reading resume markers back off disk.
//
// Advisory state, so a malformed entry is DROPPED rather than failing the load. Every other section
// of the store file refuses the whole file on a bad row, which is right for a lease and wrong for
// this: a resume marker must never be able to cost a user their entire session store.

import {
  isAgentSessionResumeMarker,
  type AgentSessionResumeMarker
} from '../../shared/agent-session-resume-marker'

export function parseAgentSessionResumeMarkers(
  value: unknown
): Map<string, AgentSessionResumeMarker> {
  const markers = new Map<string, AgentSessionResumeMarker>()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return markers
  }
  for (const [sessionId, entry] of Object.entries(value)) {
    if (isAgentSessionResumeMarker(entry) && entry.sessionId === sessionId) {
      markers.set(sessionId, entry)
    }
  }
  return markers
}
