// Binds the two halves of PTY ownership to one durable file: the recorder that writes a record
// when a PTY starts, and the reconciler that retires it. They must share a store or the periodic
// sweep would be reading a different set of PTYs than the daemon actually owns.

import { dirname } from 'node:path'
import { DaemonOrphanReconciler } from './daemon-orphan-reconciler'
import { PtyOwnershipRecordStore, getPtyOwnershipRecordPath } from './pty-ownership-record-store'
import { PtyOwnershipRecorder } from './pty-ownership-recorder'
import type { LiveSessionIdentity } from './daemon-orphan-reap-plan'

export type DaemonPtyOwnership = {
  recorder: PtyOwnershipRecorder
  reconciler: DaemonOrphanReconciler
}

export type DaemonPtyOwnershipOptions = {
  /** The daemon's pid record. Its directory is the runtime directory, which scopes ownership to
   *  one endpoint and one protocol generation exactly as the pid file itself does. */
  pidPath: string | null
  protocolVersion: number
  daemonStartedAtMs: number | null
  listLiveSessions: () => LiveSessionIdentity[]
  log: (event: string, details?: Record<string, unknown>) => void
}

/**
 * Null when the daemon was launched without a pid record: there is then no runtime directory to
 * anchor durable ownership to, which is the case for adopted old daemons and fixtures. Those keep
 * the event-driven teardown they have always had, and simply gain no backstop.
 */
export function createDaemonPtyOwnership(
  options: DaemonPtyOwnershipOptions
): DaemonPtyOwnership | null {
  if (!options.pidPath) {
    return null
  }
  const store = new PtyOwnershipRecordStore(
    getPtyOwnershipRecordPath(dirname(options.pidPath), options.protocolVersion)
  )
  return {
    recorder: new PtyOwnershipRecorder({
      store,
      daemon: { pid: process.pid, startedAtMs: options.daemonStartedAtMs },
      isLive: ({ sessionId, incarnationId, pid }) =>
        options
          .listLiveSessions()
          .some(
            (session) =>
              session.sessionId === sessionId &&
              session.incarnationId === incarnationId &&
              session.pid === pid
          )
    }),
    reconciler: new DaemonOrphanReconciler({
      store,
      listLiveSessions: options.listLiveSessions,
      log: options.log
    })
  }
}
