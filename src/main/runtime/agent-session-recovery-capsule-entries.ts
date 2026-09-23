// The shape of the recovery capsule on disk, and how a stored set of entries is read back.
//
// Split from the capsule so the file format — the three entry states, their fields, the legacy v1
// layout — can be read on its own. Every value parsed here re-enters from a file this process did
// not necessarily write.

import { z } from 'zod'
import {
  AGENT_SESSION_RESUME_FAILURE_OUTCOMES,
  isExpiredAgentSessionResumeMarker,
  parseAgentSessionResumeMarker,
  type AgentSessionResumeFailureOutcome,
  type AgentSessionResumeMarker
} from '../../shared/agent-session-resume-marker'

const RESUME_ACTION_LEASE_TTL_MS = 10 * 60 * 1000
export const MAX_FAILURE_FIELD_LENGTH = 512

const legacyCapsuleSchema = z.object({ version: z.literal(1), markers: z.array(z.unknown()) })
const entrySchema = z.object({
  state: z.enum(['pending', 'in-progress', 'failed']),
  operationId: z.string().min(1).optional(),
  startedAt: z.number().int().nonnegative().optional(),
  failedAt: z.number().int().nonnegative().optional(),
  outcome: z.enum(AGENT_SESSION_RESUME_FAILURE_OUTCOMES).optional(),
  reason: z.string().max(MAX_FAILURE_FIELD_LENGTH).optional(),
  latestPrompt: z.string().max(MAX_FAILURE_FIELD_LENGTH).optional(),
  marker: z.unknown(),
  replacement: z.unknown().optional()
})
const capsuleSchema = z.object({
  version: z.literal(2),
  entries: z.array(z.unknown()),
  dismissedAt: z.number().int().nonnegative().optional()
})

/** What an acted-on offer left behind when the agent did not carry on. Kept so the status bar can
 *  keep pointing at the chat after the offer itself is spent; dies with the marker's TTL, an
 *  explicit dismissal, a successful retry, or the user's own send. */
export type AgentSessionResumeFailureRecord = {
  marker: AgentSessionResumeMarker
  failedAt: number
  outcome: AgentSessionResumeFailureOutcome
  reason: string
  /** The prompt the offer quoted, snapshotted because the session may no longer be readable. */
  latestPrompt: string
}

export type AgentSessionResumeFailureInput = Omit<AgentSessionResumeFailureRecord, 'marker'> & {
  sessionId: string
}

export type RecoveryEntry =
  | {
      state: 'pending' | 'in-progress'
      operationId?: string
      startedAt?: number
      marker: AgentSessionResumeMarker
      replacement?: AgentSessionResumeMarker
    }
  | ({ state: 'failed'; replacement?: AgentSessionResumeMarker } & AgentSessionResumeFailureRecord)

export type RecoveryCapsuleState = {
  entries: RecoveryEntry[]
  dismissedAt?: number
}

function parseMarker(value: unknown): AgentSessionResumeMarker {
  const marker = parseAgentSessionResumeMarker(value)
  if (!marker) {
    throw new Error('agent_session_recovery_capsule_invalid')
  }
  return marker
}

export function parseState(raw: string): RecoveryCapsuleState {
  const value: unknown = JSON.parse(raw)
  const legacy = legacyCapsuleSchema.safeParse(value)
  if (legacy.success) {
    return {
      entries: legacy.data.markers.map((marker) => ({
        state: 'pending',
        marker: parseMarker(marker)
      }))
    }
  }
  const capsule = capsuleSchema.parse(value)
  const entries = capsule.entries.map((entry) => {
    const parsed = entrySchema.parse(entry)
    const marker = parseMarker(parsed.marker)
    const replacement =
      parsed.replacement === undefined ? undefined : parseMarker(parsed.replacement)
    if (replacement && replacement.sessionId !== marker.sessionId) {
      throw new Error('agent_session_recovery_capsule_invalid')
    }
    if (parsed.state === 'pending') {
      return { state: 'pending' as const, marker, ...(replacement ? { replacement } : {}) }
    }
    if (parsed.state === 'failed') {
      if (
        parsed.failedAt === undefined ||
        parsed.outcome === undefined ||
        parsed.reason === undefined
      ) {
        throw new Error('agent_session_recovery_capsule_invalid')
      }
      return {
        state: 'failed' as const,
        marker,
        failedAt: parsed.failedAt,
        outcome: parsed.outcome,
        reason: parsed.reason,
        latestPrompt: parsed.latestPrompt ?? '',
        ...(replacement ? { replacement } : {})
      }
    }
    if (parsed.operationId === undefined || parsed.startedAt === undefined) {
      throw new Error('agent_session_recovery_capsule_invalid')
    }
    return {
      state: 'in-progress' as const,
      operationId: parsed.operationId,
      startedAt: parsed.startedAt,
      marker,
      ...(replacement ? { replacement } : {})
    }
  })
  return {
    entries,
    ...(capsule.dismissedAt === undefined ? {} : { dismissedAt: capsule.dismissedAt })
  }
}

export function normalizeEntries(entries: readonly RecoveryEntry[], now: number): RecoveryEntry[] {
  const bySession = new Map<string, RecoveryEntry>()
  for (const entry of entries) {
    const replacement =
      entry.replacement && !isExpiredAgentSessionResumeMarker(entry.replacement, now)
        ? entry.replacement
        : undefined
    if (isExpiredAgentSessionResumeMarker(entry.marker, now) && replacement === undefined) {
      continue
    }
    if (bySession.has(entry.marker.sessionId)) {
      throw new Error('agent_session_recovery_capsule_duplicate_session')
    }
    const reclaimed =
      entry.state === 'in-progress' &&
      entry.startedAt !== undefined &&
      now - entry.startedAt > RESUME_ACTION_LEASE_TTL_MS
    // A newer teardown witness supersedes a pending offer AND a recorded failure: the chat was
    // working again, so the old verdict no longer describes it.
    const normalized: RecoveryEntry =
      entry.state === 'in-progress' && reclaimed
        ? { state: 'pending', marker: replacement ?? entry.marker }
        : (entry.state === 'pending' || entry.state === 'failed') && replacement
          ? { state: 'pending', marker: replacement }
          : replacement
            ? { ...entry, replacement }
            : entry
    bySession.set(normalized.marker.sessionId, normalized)
  }
  return [...bySession.values()]
}

export function shouldReplaceMarker(
  current: AgentSessionResumeMarker,
  incoming: AgentSessionResumeMarker
): boolean {
  if (incoming.recordedAt !== current.recordedAt) {
    return incoming.recordedAt > current.recordedAt
  }
  // A single teardown may publish the same witness more than once. Different teardown IDs at the
  // same clock value have no ordering signal, so keep the first one rather than let a late writer
  // regress a newer witness from another host.
  return incoming.teardownId === current.teardownId
}
