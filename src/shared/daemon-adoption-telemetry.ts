// Enums for the `daemon_adopted` and `daemon_pty_cwd_denied` telemetry events (#17696).
// Both exist to measure how often a macOS app runs on a daemon left behind by an earlier app
// bundle, and how often such a daemon actually spawns a terminal whose cwd it cannot read.
// Enum-only: no paths, versions, or exact counts ever reach the wire.

/** How the adopted daemon's recorded app version compares to the running app. */
export const DAEMON_ADOPTED_APP_VERSION_MATCH = ['same', 'different', 'unknown'] as const
export type DaemonAdoptedAppVersionMatch = (typeof DAEMON_ADOPTED_APP_VERSION_MATCH)[number]

/**
 * Where the binary that forked the adopted daemon lives now. `updater-cache` is the Squirrel
 * ShipIt staging area — a daemon attributed there is the reported #17696 shape.
 */
export const DAEMON_SPAWNER_PATH_CLASSES = [
  'applications',
  'updater-cache',
  'other',
  'missing',
  'unknown'
] as const
export type DaemonSpawnerPathClass = (typeof DAEMON_SPAWNER_PATH_CLASSES)[number]

export const DAEMON_TCC_ATTRIBUTION_VALUES = ['intact', 'severed', 'unknown'] as const

/**
 * What macOS itself can still say about the daemon process's own code (#21826).
 *
 * `resolved`: macOS maps the pid to an executable that still exists and is not under a Squirrel
 * ShipIt parking directory. Deliberately not "inside the installed app": proving that needs the
 * pid record's spawner path, and acting on where the code lives is #21826's proposal, not this
 * measurement.
 * `parked`: the executable resolves inside a `…ShipIt…` directory, the copy Squirrel moves the
 * outgoing bundle to during an update.
 * `unresolvable`: macOS cannot map the pid to on-disk code at all, which is where tccd stops
 * being able to resolve the daemon's code identity.
 * `probe-failed`: the probe could not answer — not macOS, no pid, no codesign, timeout, or
 * output it could not parse.
 *
 * Measurement only — nothing reads this verdict to decide anything.
 */
export const DAEMON_CODE_IDENTITY_VALUES = [
  'resolved',
  'parked',
  'unresolvable',
  'probe-failed'
] as const
export type DaemonCodeIdentity = (typeof DAEMON_CODE_IDENTITY_VALUES)[number]

/** Which macOS-protected folder class the denied cwd falls under. */
export const DAEMON_PTY_CWD_CLASSES = [
  'documents',
  'desktop',
  'downloads',
  'other-home',
  'outside-home'
] as const
export type DaemonPtyCwdClass = (typeof DAEMON_PTY_CWD_CLASSES)[number]

/**
 * The classes macOS gates behind a per-app TCC row, which is what `tccutil reset` acts on. The
 * other two are denied through something else, so there is no row to clear and no reset to offer.
 */
export const MAC_TCC_FOLDER_CLASSES = ['documents', 'desktop', 'downloads'] as const
export type MacTccFolderClass = (typeof MAC_TCC_FOLDER_CLASSES)[number]

export function isMacTccFolderClass(cwdClass: DaemonPtyCwdClass): cwdClass is MacTccFolderClass {
  return MAC_TCC_FOLDER_CLASSES.some((name) => name === cwdClass)
}

export function classifyDaemonSpawnerPath(
  spawnerExecPath: string | null,
  exists: (path: string) => boolean
): DaemonSpawnerPathClass {
  if (!spawnerExecPath) {
    return 'unknown'
  }
  if (!exists(spawnerExecPath)) {
    return 'missing'
  }
  if (/\/Library\/Caches\/[^/]*ShipIt\//.test(spawnerExecPath)) {
    return 'updater-cache'
  }
  return /^(?:\/private)?\/Applications\//.test(spawnerExecPath) ? 'applications' : 'other'
}

export function classifyDaemonPtyCwd(cwd: string, homeDir: string): DaemonPtyCwdClass {
  const home = homeDir.replace(/\/+$/, '')
  if (!home || !(cwd === home || cwd.startsWith(`${home}/`))) {
    return 'outside-home'
  }
  const topLevel = cwd.slice(home.length + 1).split('/')[0]
  switch (topLevel) {
    case 'Documents':
      return 'documents'
    case 'Desktop':
      return 'desktop'
    case 'Downloads':
      return 'downloads'
    default:
      return 'other-home'
  }
}
