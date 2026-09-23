// Why two: one covers the create/delete overlap the scan is re-run for; a second mutation landing
// inside that re-run is the churn case, and a third pass would only chase it.
export const SUPERSEDED_SCAN_RESCANS = 2

/**
 * Runs the scan again while a worktree mutation overtook it. A listing speaks for the catalog as of
 * when its scan began, so a scan that a create or delete landed under describes a catalog that no
 * longer exists; published as authoritative, it tells every client that a worktree created during
 * the scan was deleted, and the client retires it. Re-running through the same thunk keeps the
 * guard chain (cache, joiners, side-effect tokens) intact for the second pass.
 *
 * Returns the final scan. One still marked `superseded` spent the bound (or the caller withdrew):
 * its rows must not be published as authoritative, and each listing decides what it answers
 * instead, because the reply shapes differ between the desktop and runtime wires.
 */
export async function scanUntilNotOvertaken<T extends { superseded: boolean }>(
  scanOnce: () => Promise<T>,
  mayRescan: () => boolean
): Promise<T> {
  let scan = await scanOnce()
  for (let rescans = 0; scan.superseded; rescans += 1) {
    if (rescans >= SUPERSEDED_SCAN_RESCANS || !mayRescan()) {
      return scan
    }
    scan = await scanOnce()
  }
  return scan
}
