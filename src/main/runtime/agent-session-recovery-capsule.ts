import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AGENT_SESSION_RESUME_MARKER_TTL_MS,
  isExpiredAgentSessionResumeMarker,
  type AgentSessionResumeMarker
} from '../../shared/agent-session-resume-marker'
import { readNodeFileWithinLimit } from '../../shared/node-bounded-file-reader'
import { stringifyJsonWithinByteLimit } from '../../shared/node-bounded-json-stringify'
import {
  durableWriteTempPath,
  removeStaleDurableWriteTempFiles,
  renameDurable,
  writeTempFileDurable
} from '../durable-file-write'
import { withFileTransactionLock } from '../file-transaction-lock'
import {
  MAX_FAILURE_FIELD_LENGTH,
  normalizeEntries,
  parseState,
  shouldReplaceMarker,
  type AgentSessionResumeFailureInput,
  type AgentSessionResumeFailureRecord,
  type RecoveryCapsuleState,
  type RecoveryEntry
} from './agent-session-recovery-capsule-entries'

export type {
  AgentSessionResumeFailureInput,
  AgentSessionResumeFailureRecord
} from './agent-session-recovery-capsule-entries'

export const AGENT_SESSION_RECOVERY_CAPSULE_FILE = 'agent-session-recovery.json'
const MAX_CAPSULE_BYTES = 4 * 1024 * 1024

/** Durable, per-session restart offers. Listing never spends an offer. */
export class AgentSessionRecoveryCapsule {
  private readonly filePath: string

  constructor(stateDirectory: string) {
    this.filePath = join(stateDirectory, AGENT_SESSION_RECOVERY_CAPSULE_FILE)
  }

  list(now: number): Promise<AgentSessionResumeMarker[]> {
    return withFileTransactionLock(this.filePath, async () => {
      const entries = normalizeEntries((await this.readState()).entries, now)
      return entries.filter((entry) => entry.state === 'pending').map((entry) => entry.marker)
    })
  }

  /** Offers that were acted on and did not end with the agent carrying on. Read-only, like `list`. */
  listFailed(now: number): Promise<AgentSessionResumeFailureRecord[]> {
    return withFileTransactionLock(this.filePath, async () => {
      const entries = normalizeEntries((await this.readState()).entries, now)
      return entries.flatMap((entry) =>
        entry.state === 'failed'
          ? [
              {
                marker: entry.marker,
                failedAt: entry.failedAt,
                outcome: entry.outcome,
                reason: entry.reason,
                latestPrompt: entry.latestPrompt
              }
            ]
          : []
      )
    })
  }

  /** Adds fresh teardown witnesses while preserving an action already in progress. */
  record(markers: readonly AgentSessionResumeMarker[], now: number): Promise<void> {
    return withFileTransactionLock(this.filePath, async () => {
      const state = await this.readState()
      const entries = normalizeEntries(state.entries, now)
      const bySession = new Map(entries.map((entry) => [entry.marker.sessionId, entry]))
      const dismissedAt = state.dismissedAt
      for (const marker of markers) {
        if (
          isExpiredAgentSessionResumeMarker(marker, now) ||
          (dismissedAt !== undefined && marker.recordedAt <= dismissedAt)
        ) {
          continue
        }
        const existing = bySession.get(marker.sessionId)
        if (existing?.state === 'in-progress') {
          const current = existing.replacement ?? existing.marker
          if (
            shouldReplaceMarker(current, marker) &&
            (marker.recordedAt > current.recordedAt || marker.teardownId !== current.teardownId)
          ) {
            bySession.set(marker.sessionId, { ...existing, replacement: marker })
          }
          continue
        }
        if (existing && !shouldReplaceMarker(existing.marker, marker)) {
          continue
        }
        bySession.set(marker.sessionId, { state: 'pending', marker })
      }
      // Keep the fence after a newer interruption. It still admits genuinely newer markers,
      // while an older delayed writer remains unable to resurrect a dismissed chat later.
      await this.publish([...bySession.values()], dismissedAt)
    })
  }

  /** Reserves only the selected pending sessions for one explicit user action. A recorded failure
   *  is reserved too when the action names it — that is a retry — but never by an unselective
   *  action, which must not re-run what already failed. */
  beginResume(
    sessionIds: readonly string[] | undefined,
    operationId: string,
    now: number
  ): Promise<AgentSessionResumeMarker[]> {
    return withFileTransactionLock(this.filePath, async () => {
      const state = await this.readState()
      const entries = normalizeEntries(state.entries, now)
      const requested = sessionIds === undefined ? null : new Set(sessionIds)
      const selected: AgentSessionResumeMarker[] = []
      const next = entries.map((entry) => {
        const named = requested !== null && requested.has(entry.marker.sessionId)
        const eligible =
          entry.state === 'pending'
            ? requested === null || named
            : entry.state === 'failed' && named
        if (!eligible) {
          return entry
        }
        selected.push(entry.marker)
        return { state: 'in-progress' as const, operationId, startedAt: now, marker: entry.marker }
      })
      await this.publish(next, state.dismissedAt)
      return selected
    })
  }

  completeResume(operationId: string, sessionIds: readonly string[], now: number): Promise<void> {
    return withFileTransactionLock(this.filePath, async () => {
      const selected = new Set(sessionIds)
      const state = await this.readState()
      const entries = normalizeEntries(state.entries, now).flatMap((entry) => {
        if (
          entry.state !== 'in-progress' ||
          entry.operationId !== operationId ||
          !selected.has(entry.marker.sessionId)
        ) {
          return [entry]
        }
        return entry.replacement ? [{ state: 'pending' as const, marker: entry.replacement }] : []
      })
      await this.publish(entries, state.dismissedAt)
    })
  }

  /** Records how a reserved session's action ended when the agent did not carry on. Only rows this
   *  operation owns move, so a competing owner's reservation cannot be settled by proxy. */
  failResume(
    operationId: string,
    failures: readonly AgentSessionResumeFailureInput[],
    now: number
  ): Promise<void> {
    return withFileTransactionLock(this.filePath, async () => {
      const bySession = new Map(failures.map((failure) => [failure.sessionId, failure]))
      const state = await this.readState()
      const entries = normalizeEntries(state.entries, now).map((entry): RecoveryEntry => {
        const failure =
          entry.state === 'in-progress' && entry.operationId === operationId
            ? bySession.get(entry.marker.sessionId)
            : undefined
        if (!failure) {
          return entry
        }
        return {
          state: 'failed',
          marker: entry.marker,
          failedAt: failure.failedAt,
          outcome: failure.outcome,
          reason: failure.reason.slice(0, MAX_FAILURE_FIELD_LENGTH),
          latestPrompt: failure.latestPrompt.slice(0, MAX_FAILURE_FIELD_LENGTH),
          ...(entry.replacement ? { replacement: entry.replacement } : {})
        }
      })
      await this.publish(entries, state.dismissedAt)
    })
  }

  /** Forgets the named sessions whatever their state. Unlike `clearAll`, this is not a fence: a
   *  later teardown of the same chat may record a fresh offer. */
  dismiss(sessionIds: readonly string[], now: number): Promise<number> {
    return withFileTransactionLock(this.filePath, async () => {
      const named = new Set(sessionIds)
      const state = await this.readState()
      const entries = normalizeEntries(state.entries, now)
      const kept = entries.filter((entry) => !named.has(entry.marker.sessionId))
      if (kept.length !== entries.length) {
        await this.publish(kept, state.dismissedAt)
      }
      return entries.length - kept.length
    })
  }

  rollbackResume(operationId: string, now: number): Promise<void> {
    return withFileTransactionLock(this.filePath, async () => {
      const state = await this.readState()
      const entries = normalizeEntries(state.entries, now).flatMap((entry) => {
        if (entry.state !== 'in-progress' || entry.operationId !== operationId) {
          return [entry]
        }
        return [{ state: 'pending' as const, marker: entry.replacement ?? entry.marker }]
      })
      await this.publish(entries, state.dismissedAt)
    })
  }

  clearAll(now: number): Promise<number> {
    return withFileTransactionLock(this.filePath, async () => {
      let entries: RecoveryEntry[]
      try {
        entries = normalizeEntries((await this.readState()).entries, now)
      } catch {
        // Dismiss is an explicit request to forget this advisory file. Replace unreadable bytes
        // with an empty, fenced capsule so a late teardown writer cannot resurrect the offer.
        await this.publish([], now)
        return 0
      }
      const pending = entries.filter((entry) => entry.state === 'pending')
      // Dismiss is the explicit user request to forget every recovery record. An in-flight
      // action may still finish, but its later complete/rollback becomes a no-op and cannot
      // resurrect a row the user dismissed.
      await this.publish([], now)
      return pending.length
    })
  }

  private async readState(): Promise<RecoveryCapsuleState> {
    let raw: string
    try {
      raw = (await readNodeFileWithinLimit(this.filePath, MAX_CAPSULE_BYTES)).buffer.toString(
        'utf8'
      )
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { entries: [] }
      }
      throw error
    }
    return parseState(raw)
  }

  private async publish(entries: readonly RecoveryEntry[], dismissedAt?: number): Promise<void> {
    const { serialized } = stringifyJsonWithinByteLimit(
      { version: 2, entries, ...(dismissedAt === undefined ? {} : { dismissedAt }) },
      MAX_CAPSULE_BYTES
    )
    await removeStaleDurableWriteTempFiles(this.filePath, {
      minimumAgeMs: AGENT_SESSION_RESUME_MARKER_TTL_MS
    })
    const tempPath = durableWriteTempPath(this.filePath)
    try {
      await writeTempFileDurable(tempPath, serialized, 0o600)
      await renameDurable(tempPath, this.filePath)
    } finally {
      await rm(tempPath, { force: true }).catch(() => {})
    }
  }
}
