/**
 * Which `rg` the relay spawns. The SSH deploy uploads Orca's own ripgrep to a version-keyed cache
 * and passes its path via `--ripgrep-path`; PATH `rg` (and then the git/readdir fallbacks) stays
 * the answer whenever that binary is absent or cannot launch on this host.
 */
import { existsSync } from 'node:fs'
import {
  isRipgrepSpawnCwdUsable,
  isTransientRipgrepSpawnError
} from '../shared/ripgrep-process-availability'
import { relayLogLine } from './relay-diagnostic-log'

export const PATH_RIPGREP_COMMAND = 'rg'

let bundledRipgrepPath: string | null = null
// Why a back-off, not forever: Windows AV often locks a just-installed rg.exe for its first spawns.
const BUNDLED_RIPGREP_RETRY_MS = 60_000
let bundledRipgrepUnusableUntil = 0

export function configureRelayBundledRipgrep(path: string | undefined): void {
  bundledRipgrepPath = path ? path : null
  bundledRipgrepUnusableUntil = 0
}

export function resolveRelayRipgrepCommand(): string {
  // Why check existence per spawn: the deploy uploads rg after the relay starts, so it can appear mid-session.
  if (
    bundledRipgrepPath &&
    Date.now() >= bundledRipgrepUnusableUntil &&
    existsSync(bundledRipgrepPath)
  ) {
    return bundledRipgrepPath
  }
  return PATH_RIPGREP_COMMAND
}

/**
 * Called when `command` failed to launch. Resolves true when it was the bundled binary and the
 * caller should retry once on PATH `rg`; spawns skip the bundled binary for a back-off window.
 */
export async function retryRipgrepOnPathAfterLaunchFailure(
  command: string,
  cwd: string,
  error?: unknown
): Promise<boolean> {
  if (command === PATH_RIPGREP_COMMAND || command !== bundledRipgrepPath) {
    return false
  }
  // Why: fd/process pressure says nothing about the binary, so it must not disable it for the relay's life.
  if (isTransientRipgrepSpawnError(error)) {
    return false
  }
  // Why: spawn reports a missing cwd as ENOENT too; that says nothing about the binary.
  if (!(await isRipgrepSpawnCwdUsable(cwd))) {
    return false
  }
  // Why only while the file exists: a removed binary is re-checked per spawn anyway.
  if (existsSync(command) && Date.now() >= bundledRipgrepUnusableUntil) {
    bundledRipgrepUnusableUntil = Date.now() + BUNDLED_RIPGREP_RETRY_MS
    relayLogLine(`[relay] Bundled ripgrep at ${command} failed to launch; using rg from PATH`)
  }
  return true
}
