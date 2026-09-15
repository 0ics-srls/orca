// What a teardown recorded about a session that was genuinely working when the app went away.
//
// A marker is written ONLY by the teardown path, from the live runtime — never derived from a
// persisted `running` row, which survives a crash and would resurrect work nobody is doing. It is
// the first of two records a resume needs: the journal's own turn record has to name the same turn
// before anything is handed a provider child again.
//
// Markers are transient obligations, so each one carries the two ways it can die: it is consumed on
// the resume that uses it, and it expires on its own if no launch ever does.

/** Why the app went away. Recorded because an update install is a restart the user did not choose,
 *  and the surface that offers the resume says so. */
export const AGENT_SESSION_RESUME_TRIGGERS = ['quit', 'update'] as const
export type AgentSessionResumeTrigger = (typeof AGENT_SESSION_RESUME_TRIGGERS)[number]

/** A marker older than this is ignored and pruned: relaunching a week later must not restart a turn
 *  the user has long since forgotten, and an obligation with no expiry strands forever. */
export const AGENT_SESSION_RESUME_MARKER_TTL_MS = 24 * 60 * 60 * 1000

export type AgentSessionResumeMarker = {
  sessionId: string
  /** The turn that was running when teardown observed it, from the live journal. */
  turnId: string
  /** Execution host's clock at teardown. */
  recordedAt: number
  trigger: AgentSessionResumeTrigger
  /**
   * IDENTITY ROOT of the provider handle this session had proved at teardown — deliberately not the
   * full handle key.
   *
   * The key embeds Claude's leaf uuid, which is a branch cursor, and the adapter's own close path
   * appends a `resumed` link with an advanced leaf seconds after the marker is written. Comparing
   * keys therefore refuses every Claude session forever. The root is the part a resume must
   * preserve — a resume that changes it forked — which is exactly what this guard is for.
   */
  providerHandleRoot: string
}

const MAX_FIELD_LENGTH = 512

function isMarkerField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH
}

export function isAgentSessionResumeMarker(value: unknown): value is AgentSessionResumeMarker {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const marker = value as Partial<AgentSessionResumeMarker>
  return (
    isMarkerField(marker.sessionId) &&
    isMarkerField(marker.turnId) &&
    isMarkerField(marker.providerHandleRoot) &&
    Number.isSafeInteger(marker.recordedAt) &&
    (marker.recordedAt as number) >= 0 &&
    (marker.trigger === 'quit' || marker.trigger === 'update')
  )
}

export function isExpiredAgentSessionResumeMarker(
  marker: AgentSessionResumeMarker,
  now: number
): boolean {
  // A marker from the future is a clock that moved backwards, not a fresh one; treat it as expired
  // rather than let it outlive every TTL.
  return now < marker.recordedAt || now - marker.recordedAt > AGENT_SESSION_RESUME_MARKER_TTL_MS
}
