const MUSE_VERSIONED_BINARY_PREFIX = 'muse-bin-'

/** The `muse` launcher execs `muse-bin-<version>` (`.exe` on Windows). */
export function isMuseVersionedBinary(processName: string): boolean {
  return processName.startsWith(MUSE_VERSIONED_BINARY_PREFIX)
}

/** Scoped to an expected `muse` process so other agents keep exact-name matching. */
export function isMuseExpectedProcess(processName: string, expectedProcess: string): boolean {
  return expectedProcess === 'muse' && isMuseVersionedBinary(processName)
}
