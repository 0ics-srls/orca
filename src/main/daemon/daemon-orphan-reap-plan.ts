// Decides, from one process-table capture and the daemon's durable PTY ownership records, which
// processes are leftovers nobody owns any more. Pure: no clock, no signals, no disk — every input
// is passed in, so the classification can be tested without a single real process.
//
// The correlation key is the process group, because it is the only thing about a PTY's tree that
// survives the root: once the root exits its children reparent to pid 1 and a parent walk can
// never find them again. A group id outlives its leader too, though, so a recorded group is
// believed only after three independent screens agree it still holds our processes and nobody
// else's — see `screenRecordedGroups`.

import { collectDescendantRows } from '../pty-descendant-termination'
import type { ProcessTableRow } from '../pty-process-table-parser'
import { ptyOwnershipRecordKey, recordKeyOf, type PtyOwnershipRecord } from './pty-ownership-record'

/** Why a record is being acted on. `stranded_root` is the stronger of the two: the PTY's own root
 *  is still running under the identity we recorded, so ownership needs no inference at all. */
export type OrphanReapReason = 'stranded_root' | 'orphaned_group'

/** Why a record was retired. Both are ways for the obligation to die. */
export type OrphanRecordDropReason = 'settled' | 'expired' | 'unclaimable'

/** Why a record was left alone this tick. Named rather than silent, because "nothing was there"
 *  and "we refused to act on what was there" are different facts when a leak is investigated. */
export type OrphanReapSkipReason =
  | 'live_session'
  | 'owning_daemon_alive'
  | 'within_spawn_grace'
  | 'no_root_identity'
  | 'root_pid_reused'
  | 'protected_ancestry'
  | 'awaiting_second_observation'

export type LiveSessionIdentity = {
  sessionId: string
  /** Absent on a session whose generation the host could not report. That ambiguity protects every
   *  record for the session id rather than none of them: "some generation of this is live" is a
   *  reason to leave all of them alone, never a reason to reap the ones that did not match. */
  incarnationId?: string
}

export type OrphanReapTarget = {
  key: string
  sessionId: string
  incarnationId: string
  reason: OrphanReapReason
  pgids: number[]
  members: ProcessTableRow[]
}

export type OrphanReapPlan = {
  /** Groups seen on two consecutive observations and cleared by every identity screen. */
  reap: OrphanReapTarget[]
  /** Record keys that looked reapable for the first time. Carried to the next tick, nothing else. */
  confirmNext: string[]
  /** Live records whose groups and root identity were re-derived from this capture. */
  refreshed: PtyOwnershipRecord[]
  dropped: { key: string; sessionId: string; reason: OrphanRecordDropReason }[]
  skipped: { key: string; sessionId: string; reason: OrphanReapSkipReason }[]
}

export type OrphanReapPlanInput = {
  records: readonly PtyOwnershipRecord[]
  /** Sessions this daemon currently has a live root for. */
  liveSessions: readonly LiveSessionIdentity[]
  table: readonly ProcessTableRow[]
  /** This daemon's own pid: its ancestry is excluded from every candidate set, and a process it
   *  still parents is by definition its own to reap. */
  selfPid: number
  /** Record keys that already looked reapable on the previous tick. */
  pendingConfirmations: ReadonlySet<string>
  nowMs: number
  /** A record younger than this is never reaped, so a create still settling cannot be swept by a
   *  tick that lands between the spawn and the host's session map write. */
  spawnGraceMs: number
  /** A record older than this is abandoned: a day of ticks never managed to identify its
   *  processes, and holding it only accumulates pid-reuse exposure. */
  maxRecordAgeMs: number
  /** Tolerance when matching a recorded daemon start time against a process table's second-
   *  resolution `lstart`. */
  daemonStartToleranceMs: number
}

function parseStartedAtMs(startedAt: string | null | undefined): number | null {
  if (!startedAt) {
    return null
  }
  const parsed = Date.parse(startedAt)
  return Number.isFinite(parsed) ? parsed : null
}

function indexByPid(table: readonly ProcessTableRow[]): Map<number, ProcessTableRow> {
  const byPid = new Map<number, ProcessTableRow>()
  for (const row of table) {
    // A non-atomic capture can carry both an old and a recycled row for one pid; keep the first
    // so every reader of this index agrees on which one it saw.
    if (!byPid.has(row.pid)) {
      byPid.set(row.pid, row)
    }
  }
  return byPid
}

/**
 * Every pid in this daemon's own parent chain, plus the process group of each. A development
 * daemon shares a terminal and often a process group with the shell that launched it, and no
 * record may ever make one of those a reap candidate.
 */
export function collectProtectedAncestry(
  table: readonly ProcessTableRow[],
  selfPid: number
): { pids: Set<number>; pgids: Set<number> } {
  const byPid = indexByPid(table)
  const pids = new Set<number>([selfPid])
  // 0 and 1 are the kernel and init groups; signalling either is never this mechanism's job.
  const pgids = new Set<number>([0, 1])
  const selfRow = byPid.get(selfPid)
  if (selfRow) {
    pgids.add(selfRow.pgid)
  }
  for (let row = selfRow; row && row.ppid > 0;) {
    const parent = byPid.get(row.ppid)
    if (!parent || pids.has(parent.pid)) {
      break
    }
    pids.add(parent.pid)
    pgids.add(parent.pgid)
    row = parent
  }
  return { pids, pgids }
}

export type GroupScreenOutcome =
  | { verdict: 'claimed'; members: ProcessTableRow[] }
  | { verdict: 'empty' }
  | { verdict: 'protected' }
  /** The recorded group ids now hold processes that cannot be ours. */
  | { verdict: 'unclaimable' }

/**
 * Screen the processes sitting in a record's recorded groups.
 *
 * A process group id is only unique while its leader lives. Once our root has exited the number
 * can be reissued to a stranger, so occupancy alone proves nothing and three things must agree:
 *
 *  1. No member may be in the daemon's own ancestry, and no recorded group may be one of theirs.
 *  2. No member may have started before our root did — a process that predates the PTY cannot
 *     descend from it.
 *  3. Every member must look orphaned: parented by init, parented by this daemon, or parented by
 *     another member. A stranger's group is normally held together by a live parent outside it,
 *     and that parent is the thing this screen refuses to reach past.
 *
 * Any failure condemns the whole group rather than the one row, because a recycled group id makes
 * every other row in it a stranger too.
 */
export function screenRecordedGroups(
  record: PtyOwnershipRecord,
  table: readonly ProcessTableRow[],
  protectedAncestry: { pids: Set<number>; pgids: Set<number> },
  selfPid: number,
  /** The root's live row when it is provably ours. Its group counts even if the spawn-time probe
   *  never managed to record one, because identity on the root proves the group under it. */
  ourRootRow?: ProcessTableRow
): GroupScreenOutcome {
  const groups = new Set(record.pgids.filter((pgid) => pgid > 1))
  if (ourRootRow && ourRootRow.pgid > 1) {
    groups.add(ourRootRow.pgid)
  }
  if (groups.size === 0) {
    return { verdict: 'empty' }
  }
  for (const pgid of groups) {
    if (protectedAncestry.pgids.has(pgid)) {
      return { verdict: 'protected' }
    }
  }
  const rootStartedAtMs = parseStartedAtMs(record.root.startedAt)
  const members: ProcessTableRow[] = []
  for (const row of table) {
    if (!groups.has(row.pgid)) {
      continue
    }
    if (protectedAncestry.pids.has(row.pid)) {
      return { verdict: 'protected' }
    }
    const startedAtMs = parseStartedAtMs(row.startedAt)
    // `ps` reports whole seconds, so a child forked inside the root's own second ties rather than
    // losing; only a strictly earlier start proves the row predates our PTY.
    if (rootStartedAtMs !== null && startedAtMs !== null && startedAtMs < rootStartedAtMs) {
      return { verdict: 'unclaimable' }
    }
    members.push(row)
  }
  if (members.length === 0) {
    return { verdict: 'empty' }
  }
  const memberPids = new Set(members.map((row) => row.pid))
  for (const row of members) {
    if (row.ppid !== 1 && row.ppid !== selfPid && !memberPids.has(row.ppid)) {
      return { verdict: 'unclaimable' }
    }
  }
  return { verdict: 'claimed', members }
}

/** True when the daemon that wrote this record is still the process running under that pid. */
function owningDaemonStillAlive(
  record: PtyOwnershipRecord,
  byPid: ReadonlyMap<number, ProcessTableRow>,
  selfPid: number,
  toleranceMs: number
): boolean {
  if (record.daemon.pid === selfPid) {
    return false
  }
  const row = byPid.get(record.daemon.pid)
  if (!row) {
    return false
  }
  // With no recorded start time the pid alone has to carry it. Fail closed: leaving another
  // daemon's live terminals alone costs one tick, killing them costs the user their work.
  if (record.daemon.startedAtMs === null) {
    return true
  }
  const startedAtMs = parseStartedAtMs(row.startedAt)
  return startedAtMs === null || Math.abs(startedAtMs - record.daemon.startedAtMs) <= toleranceMs
}

/**
 * Re-derive a live PTY's groups from the capture, by walking down from its root.
 *
 * Done only while the root is alive in this very capture, because the parent walk is what proves
 * ownership: a group reached from our own root is ours by construction, and needs no later
 * corroboration. This is the only moment a group a child created for itself can be learned at
 * all — after the root exits the link is gone, which is why the answer has to be written down.
 */
function refreshLiveRecord(
  record: PtyOwnershipRecord,
  rootRow: ProcessTableRow | undefined,
  table: readonly ProcessTableRow[],
  nowMs: number
): PtyOwnershipRecord {
  if (!rootRow) {
    return { ...record, recordedAt: nowMs }
  }
  const pgids = new Set<number>([rootRow.pgid, ...record.pgids.filter((pgid) => pgid > 1)])
  for (const descendant of collectDescendantRows(rootRow.pid, table, nowMs).descendants) {
    if (descendant.pgid > 1) {
      pgids.add(descendant.pgid)
    }
  }
  return {
    ...record,
    root: { pid: rootRow.pid, startedAt: rootRow.startedAt },
    pgids: [...pgids],
    recordedAt: nowMs
  }
}

/**
 * Classify every durable record against one process-table capture.
 *
 * Nothing here is derived from a root this daemon is currently driving, so nothing here is
 * signalled on first sight: a record only reaches `reap` when the previous tick already reached
 * the same verdict about it. The second observation re-derives everything from scratch — the
 * first carries no member list forward, only the fact that the suspicion is not new.
 */
export function planOrphanReap(input: OrphanReapPlanInput): OrphanReapPlan {
  const plan: OrphanReapPlan = {
    reap: [],
    confirmNext: [],
    refreshed: [],
    dropped: [],
    skipped: []
  }
  const byPid = indexByPid(input.table)
  const protectedAncestry = collectProtectedAncestry(input.table, input.selfPid)
  const liveKeys = new Set<string>()
  const liveSessionIdsOfUnknownGeneration = new Set<string>()
  for (const session of input.liveSessions) {
    if (session.incarnationId === undefined) {
      liveSessionIdsOfUnknownGeneration.add(session.sessionId)
      continue
    }
    liveKeys.add(ptyOwnershipRecordKey(session.sessionId, session.incarnationId))
  }

  for (const record of input.records) {
    const key = recordKeyOf(record)
    const skip = (reason: OrphanReapSkipReason): void => {
      plan.skipped.push({ key, sessionId: record.sessionId, reason })
    }
    const drop = (reason: OrphanRecordDropReason): void => {
      plan.dropped.push({ key, sessionId: record.sessionId, reason })
    }
    const rootRow = byPid.get(record.root.pid)
    const recordedRootStartedAtMs = parseStartedAtMs(record.root.startedAt)
    const liveRootStartedAtMs = parseStartedAtMs(rootRow?.startedAt)
    // An unparseable time on either side is not evidence of a mismatch, only absence of proof.
    const ourRootRow =
      rootRow !== undefined &&
      (recordedRootStartedAtMs === null ||
        liveRootStartedAtMs === null ||
        liveRootStartedAtMs === recordedRootStartedAtMs)
        ? rootRow
        : undefined

    if (liveKeys.has(key) || liveSessionIdsOfUnknownGeneration.has(record.sessionId)) {
      plan.refreshed.push(refreshLiveRecord(record, ourRootRow, input.table, input.nowMs))
      skip('live_session')
      continue
    }
    if (input.nowMs - record.recordedAt > input.maxRecordAgeMs) {
      drop('expired')
      continue
    }
    if (owningDaemonStillAlive(record, byPid, input.selfPid, input.daemonStartToleranceMs)) {
      skip('owning_daemon_alive')
      continue
    }

    const screen = screenRecordedGroups(
      record,
      input.table,
      protectedAncestry,
      input.selfPid,
      ourRootRow
    )
    if (screen.verdict === 'protected') {
      skip('protected_ancestry')
      continue
    }
    if (screen.verdict === 'unclaimable') {
      // Our processes are unreachable through these group ids and the record can only mislead a
      // later tick. Retire it rather than re-testing it every five minutes for a day.
      drop('unclaimable')
      continue
    }
    if (screen.verdict === 'empty') {
      // Nothing of ours is left in any group this record can name, and a live root would have put
      // itself in one. The obligation is discharged, however it ended.
      drop('settled')
      continue
    }
    if (input.nowMs - record.recordedAt < input.spawnGraceMs) {
      skip('within_spawn_grace')
      continue
    }
    if (rootRow !== undefined && ourRootRow === undefined) {
      // The root pid is live but is somebody else's process, so the groups recorded under it may
      // be theirs too.
      skip('root_pid_reused')
      continue
    }
    // With no root start time nothing can be identity-checked, so nothing may be signalled. A
    // record in this state leaves only through expiry.
    if (recordedRootStartedAtMs === null && ourRootRow === undefined) {
      skip('no_root_identity')
      continue
    }

    const members =
      ourRootRow && !screen.members.some((row) => row.pid === ourRootRow.pid)
        ? [ourRootRow, ...screen.members]
        : screen.members
    if (!input.pendingConfirmations.has(key)) {
      plan.confirmNext.push(key)
      skip('awaiting_second_observation')
      continue
    }
    plan.reap.push({
      key,
      sessionId: record.sessionId,
      incarnationId: record.incarnationId,
      reason: ourRootRow ? 'stranded_root' : 'orphaned_group',
      pgids: [...new Set(members.map((row) => row.pgid))],
      members
    })
    // A reaped record keeps its confirmation, so a kill that does not take effect is retried on
    // the next tick instead of restarting its two-observation clock.
    plan.confirmNext.push(key)
  }

  return plan
}
