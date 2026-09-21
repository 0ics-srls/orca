// Evidence behind the macOS folder-access notice (STA-7948). Main-process only, at most one entry,
// keyed by the daemon that produced it: a restart mints a new identity, so the next read returns
// null and the notice clears without probing anything.

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import {
  classifyDaemonPtyCwd,
  type DaemonPtyCwdClass
} from '../../shared/daemon-adoption-telemetry'
import { track } from '../telemetry/client'
import type { DaemonEndpointIdentity } from './daemon-hello-protocol'

/** What the renderer is allowed to see: an opaque per-daemon scope and the folder class. */
export type DaemonFolderAccessMismatchNotice = {
  daemonScope: string
  cwdClass: DaemonPtyCwdClass
}

type StoredMismatch = DaemonFolderAccessMismatchNotice & {
  daemonKey: string
  canonicalPath: string
  observedAtMs: number
}

let stored: StoredMismatch | null = null
const scopesReported = new Set<string>()

function daemonKeyOf(identity: DaemonEndpointIdentity): string {
  return `${identity.pid}:${identity.startedAtMs}:${identity.launchNonce}`
}

/** Digest, never a path: the scope only has to tell two daemons apart inside one app session. */
function daemonScopeOf(daemonKey: string): string {
  return createHash('sha256').update(daemonKey).digest('hex').slice(0, 16)
}

export function recordDaemonFolderAccessMismatch(
  identity: DaemonEndpointIdentity | null,
  cwd: string
): void {
  if (!identity) {
    return
  }
  const daemonKey = daemonKeyOf(identity)
  stored = {
    daemonKey,
    daemonScope: daemonScopeOf(daemonKey),
    cwdClass: classifyDaemonPtyCwd(cwd, homedir()),
    canonicalPath: cwd,
    observedAtMs: Date.now()
  }
}

/** A later spawn this daemon could read retires its own evidence; other daemons keep theirs. */
export function clearDaemonFolderAccessMismatch(identity: DaemonEndpointIdentity | null): void {
  if (identity && stored?.daemonKey === daemonKeyOf(identity)) {
    stored = null
  }
}

/**
 * Returns evidence only while it still belongs to the daemon in use, and emits `shown` the first
 * time a given scope leaves main — the renderer therefore needs no telemetry plumbing for it.
 */
export function getDaemonFolderAccessMismatch(
  currentIdentity: DaemonEndpointIdentity | null
): DaemonFolderAccessMismatchNotice | null {
  if (!currentIdentity || !stored || stored.daemonKey !== daemonKeyOf(currentIdentity)) {
    return null
  }
  const notice = { daemonScope: stored.daemonScope, cwdClass: stored.cwdClass }
  if (!scopesReported.has(notice.daemonScope)) {
    scopesReported.add(notice.daemonScope)
    try {
      track('daemon_folder_access_notice', { action: 'shown', cwd_class: notice.cwdClass })
    } catch {
      // Telemetry is best-effort; a dropped event must not withhold the notice.
    }
  }
  return notice
}

export function resetDaemonFolderAccessMismatchForTests(): void {
  stored = null
  scopesReported.clear()
}
