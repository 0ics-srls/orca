import { readFileSync, unlinkSync } from 'node:fs'
import {
  getDaemonHistoryDir as getHistoryDir,
  probeDaemonSocket as probeSocket
} from './daemon-launch-paths'
import { parseDaemonPidFile } from './daemon-pid-file-parse'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonClient } from './client'
import { getDaemonPidPath, getDaemonSocketPath, getDaemonTokenPath } from './daemon-spawner'
import {
  CLEAN_DISCONNECT_PROTOCOL_VERSION,
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS,
  type ListSessionsResult,
  type ShutdownIfIdleResult
} from './types'

function legacyDaemonProcessMayBeAlive(runtimeDir: string, protocolVersion: number): boolean {
  try {
    const parsed = parseDaemonPidFile(
      readFileSync(getDaemonPidPath(runtimeDir, protocolVersion), 'utf8')
    )
    if (!parsed) {
      return false
    }
    process.kill(parsed.pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Retire an old daemon that has no live PTYs. Without this, every protocol
 * generation remains resident after an update even when all of its sessions
 * have exited (#9138).
 */
async function retireIdleLegacyDaemon(
  socketPath: string,
  tokenPath: string,
  protocolVersion: number
): Promise<boolean> {
  const client = new DaemonClient({ socketPath, tokenPath, protocolVersion })
  try {
    await client.ensureConnectedWithin(1_000)
    const { sessions } = await client.request<ListSessionsResult>('listSessions', undefined, 1_000)
    if (sessions.some((session) => session.isAlive)) {
      return false
    }
    if (protocolVersion >= CLEAN_DISCONNECT_PROTOCOL_VERSION) {
      const result = await client.request<ShutdownIfIdleResult>('shutdownIfIdle', undefined, 1_000)
      return result.retiring
    }
    // Older generations predate shutdownIfIdle; the inventory just proved that
    // killing this daemon cannot take a live PTY with it.
    await client.request('shutdown', { killSessions: true }, 1_000)
    return true
  } catch {
    // A failed inventory is not evidence of idleness; preserve the adapter so
    // its sessions remain adoptable on the next startup.
    return false
  } finally {
    client.disconnect()
  }
}

// Why: callers that own an isolated runtime namespace must keep discovery history out of app userData.
export async function createLegacyDaemonAdapters(
  runtimeDir: string,
  historyPath = getHistoryDir()
): Promise<DaemonPtyAdapter[]> {
  const adapters: DaemonPtyAdapter[] = []
  for (const protocolVersion of PREVIOUS_DAEMON_PROTOCOL_VERSIONS) {
    const socketPath = getDaemonSocketPath(runtimeDir, protocolVersion)
    const tokenPath = getDaemonTokenPath(runtimeDir, protocolVersion)
    if (!(await probeSocket(socketPath))) {
      // Why: a recycled stale pid later turns an identity check into a PowerShell spawn, so delete leaked pid/token files — but only when the pid-process is provably gone (a live daemon can transiently fail the probe, and dropping its token makes its sessions permanently unadoptable).
      if (!legacyDaemonProcessMayBeAlive(runtimeDir, protocolVersion)) {
        for (const stalePath of [
          getDaemonPidPath(runtimeDir, protocolVersion),
          getDaemonTokenPath(runtimeDir, protocolVersion)
        ]) {
          try {
            unlinkSync(stalePath)
          } catch {
            // Best-effort
          }
        }
      }
      continue
    }
    if (await retireIdleLegacyDaemon(socketPath, tokenPath, protocolVersion)) {
      continue
    }
    // Keep old-protocol PTYs routed to their original daemon during upgrade; legacy adapters never respawn (new code would recreate stale env semantics).
    // historyPath is still needed for cleanup — without it a later v4 session reusing the same ID could false-restore stale scrollback.bin.
    adapters.push(
      new DaemonPtyAdapter({
        socketPath,
        tokenPath,
        pidPath: getDaemonPidPath(runtimeDir, protocolVersion),
        profileScope: runtimeDir,
        runtimeDir,
        protocolVersion,
        historyPath
      })
    )
  }
  return adapters
}
