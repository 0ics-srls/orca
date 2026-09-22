// Writes down what the daemon owns, at the moment it starts owning it.
//
// The record is a consequence of the spawn, never a reservation ahead of one: it is written after
// node-pty has handed back a live pid, so a create that failed leaves nothing behind to be
// reaped. And it is bookkeeping, so it never gates the create — a terminal the user asked for
// opens whether or not this write lands.

import { execFile } from 'node:child_process'
import { ttyNameFromSlavePath, type PtyOwnershipRecord } from './pty-ownership-record'
import type { PtyOwnershipRecordStore } from './pty-ownership-record-store'

const IDENTITY_PROBE_TIMEOUT_MS = 2_000

export type SpawnedPtyIdentity = {
  sessionId: string
  incarnationId: string
  pid: number
  /** node-pty's slave device path, when the backend has one to give. */
  slavePath?: string
}

export type PtyRootIdentity = {
  pgid: number
  tty: string | null
  startedAt: string
}

/** One `ps` row for one pid. Cheap enough to run per spawn, unlike the whole-host capture the
 *  reconciler takes; the columns are the ones that outlive the root. */
export function parsePtyRootIdentity(psOutput: string): PtyRootIdentity | null {
  const match = psOutput.trim().match(/^(\d+)\s+(\S+)\s+(.+?)\s*$/)
  if (!match) {
    return null
  }
  const pgid = Number(match[1])
  if (!Number.isSafeInteger(pgid) || pgid <= 0) {
    return null
  }
  const tty = match[2]
  return {
    pgid,
    tty: tty === '?' || tty === '??' || tty === '-' ? null : tty,
    startedAt: match[3]
  }
}

function probePtyRootIdentity(pid: number): Promise<PtyRootIdentity | null> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-p', String(pid), '-o', 'pgid=,tty=,lstart='],
      {
        timeout: IDENTITY_PROBE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: { ...process.env, LANG: 'C', LC_ALL: 'C' }
      },
      (error, stdout) => resolve(error ? null : parsePtyRootIdentity(stdout))
    )
  })
}

export type PtyOwnershipRecorderOptions = {
  store: PtyOwnershipRecordStore
  daemon: { pid: number; startedAtMs: number | null }
  platform?: NodeJS.Platform
  now?: () => number
  probeIdentity?: (pid: number) => Promise<PtyRootIdentity | null>
}

/**
 * Records one PTY's OS identity twice: once synchronously with everything already in hand, then
 * again once the group and start time have been read from the OS.
 *
 * The first write exists because the gap between the two is exactly where an updater's SIGKILL
 * lands; the second exists because a record without a start time can never authorize a signal.
 * A record the probe never completes is still repaired by the reconciler on any tick where the
 * root is alive, so neither write is load bearing on its own.
 */
export class PtyOwnershipRecorder {
  constructor(private readonly options: PtyOwnershipRecorderOptions) {}

  private get supported(): boolean {
    return (this.options.platform ?? process.platform) !== 'win32'
  }

  record(identity: SpawnedPtyIdentity): void {
    if (!this.supported || !Number.isSafeInteger(identity.pid) || identity.pid <= 0) {
      return
    }
    const now = this.options.now ?? Date.now
    const base: PtyOwnershipRecord = {
      sessionId: identity.sessionId,
      incarnationId: identity.incarnationId,
      root: { pid: identity.pid, startedAt: null },
      pgids: [],
      tty: ttyNameFromSlavePath(identity.slavePath),
      daemon: { ...this.options.daemon },
      recordedAt: now()
    }
    this.write(base)
    void (this.options.probeIdentity ?? probePtyRootIdentity)(identity.pid).then((probed) => {
      if (!probed) {
        return
      }
      this.write({
        ...base,
        root: { pid: identity.pid, startedAt: probed.startedAt },
        pgids: [probed.pgid],
        tty: probed.tty ?? base.tty,
        recordedAt: now()
      })
    }, noteProbeFailure)
  }

  private write(record: PtyOwnershipRecord): void {
    try {
      this.options.store.upsert(record)
    } catch {
      // A terminal must open whether or not its bookkeeping did.
    }
  }
}

function noteProbeFailure(): void {
  // The reconciler completes the record from its own capture while the root is still alive.
}
