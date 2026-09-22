// Adapted from David Bebawy's PR #21826, which established `codesign --display` as the only
// probe that answers "where is this running pid's executable now". Kept to measurement here:
// the verdict rides on `daemon_adopted` / `daemon_pty_cwd_denied` and decides nothing.

import { existsSync } from 'node:fs'
import { runProcess } from '../../shared/child-process/run-process'
import type { DaemonCodeIdentity } from '../../shared/daemon-adoption-telemetry'

export type MacCodeIdentityCommandRunner = (
  program: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<{ code: number | null; stderr: string; stdout: string }>

const CODESIGN_PATH = '/usr/bin/codesign'
const CODESIGN_TIMEOUT_MS = 3_000

// Only ENOENT: on --display the guest lookup fails at proc_pidpath when the executable is
// unlinked. errSecCSNoSuchCode ('host has no guest') means proc_pidpath resolved but the pid is
// exiting, so it is not evidence of anything.
const UNLINKED_EXECUTABLE_PATTERN = /No such file or directory/
// Squirrel parks the outgoing bundle under a `…ShipIt…` directory in $TMPDIR or ~/Library/Caches.
const PARKED_BUNDLE_PATTERN = /\/[^/]*ShipIt[^/]*\//

const defaultRunner: MacCodeIdentityCommandRunner = (program, args, timeoutMs) =>
  runProcess({ program, args, timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })

export function classifyCodesignDisplayOutput(
  output: string,
  code: number | null
): DaemonCodeIdentity {
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('Executable=')) {
      const executablePath = line.slice('Executable='.length).trim()
      if (executablePath.length > 0) {
        if (!existsSync(executablePath)) {
          return 'unresolvable'
        }
        return PARKED_BUNDLE_PATTERN.test(executablePath) ? 'parked' : 'resolved'
      }
    }
  }
  return code !== 0 && UNLINKED_EXECUTABLE_PATTERN.test(output) ? 'unresolvable' : 'probe-failed'
}

async function probe(
  pid: number,
  runCommand: MacCodeIdentityCommandRunner
): Promise<DaemonCodeIdentity> {
  try {
    const result = await runCommand(
      CODESIGN_PATH,
      ['--display', '--verbose=1', `+${pid}`],
      CODESIGN_TIMEOUT_MS
    )
    // codesign writes both the display fields and its diagnostics to stderr.
    return classifyCodesignDisplayOutput(`${result.stderr}\n${result.stdout}`, result.code)
  } catch {
    return 'probe-failed'
  }
}

/** Concurrent asks about one pid share a probe; nothing outlives it, so no verdict is retained. */
let inFlight: { pid: number; pending: Promise<DaemonCodeIdentity> } | null = null

/**
 * Where macOS says the daemon pid's code lives, read fresh at every ask. The verdict is not
 * stable for a pid: Squirrel keeps the parked bundle until the next update, so `parked` becomes
 * `unresolvable` mid-run, and that crossover is the whole point of measuring this.
 */
export function getDaemonMacCodeIdentity(
  pid: number | null | undefined,
  runCommand: MacCodeIdentityCommandRunner = defaultRunner
): Promise<DaemonCodeIdentity> {
  if (process.platform !== 'darwin' || !pid || !Number.isSafeInteger(pid) || pid <= 0) {
    return Promise.resolve('probe-failed')
  }
  if (inFlight?.pid !== pid) {
    const entry = { pid, pending: probe(pid, runCommand) }
    inFlight = entry
    void entry.pending.then(() => {
      if (inFlight === entry) {
        inFlight = null
      }
    })
  }
  return inFlight.pending
}
