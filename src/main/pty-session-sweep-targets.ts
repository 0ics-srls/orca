import { hasUnambiguousStartTime } from './pty-descendant-termination'
import type { PtySessionProcessIdentity } from './pty-session-identity'
import type { ProcessTableRow } from './pty-process-table-parser'

export type SessionSweepTargets = {
  /** Live rows this session owns. Never contains the root itself. */
  rows: ProcessTableRow[]
  /** Groups to signal wholesale, so members forked since this read are reached too. */
  pgids: number[]
  /** Whether the root was still present in the capture these targets came from. */
  rootAlive: boolean
}

export type SessionSweepTargetInput = {
  identity: PtySessionProcessIdentity
  /** Whole-host capture: the ppid walk, known-group matches and ancestor protection all read it. */
  rows: readonly ProcessTableRow[]
  /** What `ps -t <ttyName>` returned, i.e. everything still on the session's terminal. */
  ttyRows?: readonly ProcessTableRow[] | undefined
  selfPid?: number
}

type ProtectedIdentities = { pids: Set<number>; pgids: Set<number> }

/**
 * Orca's own pid, every ancestor, and their process groups. A session's work
 * never legitimately includes the daemon, the app, or the shell that launched
 * them — but a tree member that never called setpgid can share a group with
 * one of them, and a single group signal would then take out the developer's
 * own terminal.
 */
function collectProtectedIdentities(
  rowsByPid: ReadonlyMap<number, ProcessTableRow>,
  selfPid: number
): ProtectedIdentities {
  const pids = new Set<number>()
  const pgids = new Set<number>()
  for (let cursor: number | undefined = selfPid; cursor !== undefined && cursor > 1;) {
    if (pids.has(cursor)) {
      break
    }
    pids.add(cursor)
    const row = rowsByPid.get(cursor)
    if (!row) {
      break
    }
    if (row.pgid > 1) {
      pgids.add(row.pgid)
    }
    cursor = row.ppid
  }
  return { pids, pgids }
}

function indexRows(rows: readonly ProcessTableRow[]): {
  byPid: Map<number, ProcessTableRow>
  ambiguous: Set<number>
} {
  const byPid = new Map<number, ProcessTableRow>()
  const ambiguous = new Set<number>()
  for (const row of rows) {
    if (byPid.has(row.pid)) {
      // A non-atomic read holding two rows for one pid cannot identify either.
      ambiguous.add(row.pid)
      continue
    }
    byPid.set(row.pid, row)
  }
  return { byPid, ambiguous }
}

/**
 * Resolves which live processes still belong to a PTY session, from the
 * identity captured while it was alive rather than from a live root.
 *
 * Three independent claims, unioned to a fixpoint so a process forked after the
 * root died is still reached through whichever of them names its parent:
 * - the ppid tree, while the root is present in this capture;
 * - membership of a process group this session has been seen to own;
 * - presence on the session's controlling terminal.
 *
 * The tty claim is the one that needs a boundary. Once the root exits the
 * kernel can hand that terminal to a brand-new session, so afterwards a tty row
 * counts only if it was born before the second the root died; anything later
 * has to prove itself through a group Orca already recognizes.
 */
export function collectSessionSweepTargets(input: SessionSweepTargetInput): SessionSweepTargets {
  const { identity } = input
  const selfPid = input.selfPid ?? process.pid
  const { byPid, ambiguous } = indexRows(input.rows)
  const guarded = collectProtectedIdentities(byPid, selfPid)
  const rootRow = ambiguous.has(identity.rootPid) ? undefined : byPid.get(identity.rootPid)
  // Why the exit boundary outranks the table: once the root has been reaped, a row
  // wearing its pid is a stranger that inherited the number, so the ppid walk that
  // would descend from it — and the tree it claims — belong to somebody else.
  const rootAlive =
    identity.rootExitedAtMs === null &&
    rootRow !== undefined &&
    (identity.rootStartedAt === null || identity.rootStartedAt === rootRow.startedAt)
  const rootPgid = rootAlive ? (rootRow?.pgid ?? null) : null

  const ttyPids = new Set<number>()
  // A daemon that shares the session's terminal makes the tty claim point at the
  // user's own shell; Orca already refuses group signalling in that case.
  const ttyRows = (input.ttyRows ?? []).some((row) => guarded.pids.has(row.pid))
    ? []
    : (input.ttyRows ?? [])
  for (const row of ttyRows) {
    ttyPids.add(row.pid)
    if (!byPid.has(row.pid) && !ambiguous.has(row.pid)) {
      byPid.set(row.pid, row)
    }
  }

  const knownPgids = new Set(identity.knownPgids)
  const accepted = new Map<number, ProcessTableRow>()
  const claimsTty = (row: ProcessTableRow): boolean =>
    ttyPids.has(row.pid) &&
    // While the root holds the terminal open, nobody else can have acquired it.
    (rootAlive ||
      identity.rootExitedAtMs === null ||
      hasUnambiguousStartTime(row.startedAt, identity.rootExitedAtMs))

  // Fixpoint: accepting a row teaches the sweep its group, which can in turn
  // claim a sibling, or a child forked after the root was already gone.
  for (let changed = true; changed;) {
    changed = false
    for (const row of byPid.values()) {
      if (
        accepted.has(row.pid) ||
        row.pid <= 1 ||
        row.pid === identity.rootPid ||
        row.pid === selfPid ||
        ambiguous.has(row.pid) ||
        guarded.pids.has(row.pid) ||
        guarded.pgids.has(row.pgid)
      ) {
        continue
      }
      // A ppid link to a vacated root pid is PID-reuse coincidence, not descent.
      if (
        !(
          (rootAlive && row.ppid === identity.rootPid) ||
          accepted.has(row.ppid) ||
          knownPgids.has(row.pgid) ||
          claimsTty(row)
        )
      ) {
        continue
      }
      accepted.set(row.pid, row)
      if (row.pgid > 1) {
        knownPgids.add(row.pgid)
      }
      changed = true
    }
  }

  const pgids = new Set<number>()
  for (const row of accepted.values()) {
    // The root's own group stays off the list while the root lives: its owner
    // signals the root, and a group kill here would pre-empt that ordering.
    if (row.pgid > 1 && row.pgid !== rootPgid && !guarded.pgids.has(row.pgid)) {
      pgids.add(row.pgid)
    }
  }
  return { rows: [...accepted.values()], pgids: [...pgids], rootAlive }
}
