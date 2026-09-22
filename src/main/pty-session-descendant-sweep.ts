import {
  DESCENDANT_KILL_GRACE_MS,
  DESCENDANT_SNAPSHOT_TIMEOUT_MS,
  hasUnambiguousStartIdentity,
  readProcessTable,
  readProcessTableBeforeDeadline,
  sendDescendantSignal,
  type ProcessTableReader,
  type ProcessTableRow,
  type SignalSender
} from './pty-descendant-termination'
import {
  DESCENDANT_KILL_VERIFY_MS,
  type DescendantTreeVerdict
} from './pty-descendant-exit-verification'
import {
  observePtySessionIdentity,
  rememberPtySessionPgids,
  type PtySessionProcessIdentity
} from './pty-session-identity'
import { collectSessionSweepTargets } from './pty-session-sweep-targets'
import { readTtyProcessTable, type TtyProcessTableReader } from './pty-session-tty-process-table'

const SWEEP_ROUND_INTERVAL_MS = 150

export type GroupSignalSender = (pgid: number, signal: NodeJS.Signals) => void

export type SessionDescendantSweepDeps = {
  readTable?: ProcessTableReader
  readTtyTable?: TtyProcessTableReader
  sendSignal?: SignalSender
  sendGroupSignal?: GroupSignalSender
  graceMs?: number
  verifyMs?: number
  timeoutMs?: number
  /** A departing daemon must finish escalation after its last PTY exits. */
  keepAlive?: boolean
  platform?: NodeJS.Platform
  selfPid?: number
}

export function sendProcessGroupSignal(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal)
  } catch {
    /* already gone */
  }
}

function waitForDelay(ms: number, keepAlive: boolean): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (!keepAlive) {
      timer.unref?.()
    }
  })
}

type SignalledIdentity = { startedAt: string; pgid: number }

/**
 * Terminates everything a PTY session still owns, re-deriving the target set
 * from the session's identity on every round.
 *
 * Why re-derive rather than escalate one snapshot: the set changes underneath a
 * sweep. A surviving descendant forks while the first volley is in flight, and
 * on a natural exit there is no live root to walk from at all — only the
 * session's recorded terminal and process groups can still name that work.
 *
 * Groups are signalled alongside pids so a process forked between two rounds is
 * reached without waiting to be discovered. A pid is only ever force-killed
 * when this round's own table still shows the identity that was asked to stop,
 * so a recycled pid is never signalled.
 */
export async function sweepSessionDescendants(
  identity: PtySessionProcessIdentity,
  deps: SessionDescendantSweepDeps = {}
): Promise<DescendantTreeVerdict> {
  if ((deps.platform ?? process.platform) === 'win32') {
    // Windows reaches the whole tree through the pty's job object.
    return 'exited'
  }
  if (
    identity.rootExitedAtMs !== null &&
    identity.ttyName === null &&
    identity.knownPgids.size === 0
  ) {
    // Nothing was ever recorded that could name this session's work, and its root
    // pid is now somebody else's. There is no safe target to look for.
    return 'exited'
  }
  const readTable = deps.readTable ?? readProcessTable
  const readTtyTable = deps.readTtyTable ?? readTtyProcessTable
  const sendSignal = deps.sendSignal ?? sendDescendantSignal
  const sendGroupSignal = deps.sendGroupSignal ?? sendProcessGroupSignal
  const timeoutMs = deps.timeoutMs ?? DESCENDANT_SNAPSHOT_TIMEOUT_MS
  const graceMs = deps.graceMs ?? DESCENDANT_KILL_GRACE_MS
  const keepAlive = deps.keepAlive === true
  const startedAtMs = Date.now()
  const deadline = startedAtMs + (deps.verifyMs ?? DESCENDANT_KILL_VERIFY_MS)
  const signalled = new Map<number, SignalledIdentity>()
  let verdict: DescendantTreeVerdict = 'unverifiable'

  for (;;) {
    // Why the terminal first: it answers for one pane, where the whole-host table
    // is the most expensive read Orca takes. A session that left nothing behind —
    // almost every session — is settled without ever paying for that table.
    const ttyCapture = identity.ttyName ? await readTtyTable(identity.ttyName, timeoutMs) : null
    if (
      identity.rootExitedAtMs !== null &&
      identity.knownPgids.size === 0 &&
      !ttyCapture?.rows.length
    ) {
      return 'exited'
    }
    const capture = await readProcessTableBeforeDeadline(readTable, timeoutMs)
    if (capture) {
      observePtySessionIdentity(identity, capture.rows)
      const targets = collectSessionSweepTargets({
        identity,
        rows: capture.rows,
        ...(ttyCapture ? { ttyRows: ttyCapture.rows } : {}),
        ...(deps.selfPid === undefined ? {} : { selfPid: deps.selfPid })
      })
      rememberPtySessionPgids(identity, targets.pgids)
      if (targets.rows.length === 0) {
        return 'exited'
      }
      verdict = 'live'
      const escalate = Date.now() - startedAtMs >= graceMs
      signalTargets(targets.rows, targets.pgids, capture.capturedAtMs, {
        escalate,
        signalled,
        sendSignal,
        sendGroupSignal
      })
    }
    if (Date.now() >= deadline) {
      return capture ? verdict : 'unverifiable'
    }
    await waitForDelay(SWEEP_ROUND_INTERVAL_MS, keepAlive)
  }
}

function signalTargets(
  rows: readonly ProcessTableRow[],
  pgids: readonly number[],
  capturedAtMs: number,
  args: {
    escalate: boolean
    signalled: Map<number, SignalledIdentity>
    sendSignal: SignalSender
    sendGroupSignal: GroupSignalSender
  }
): void {
  const forcedPgids = new Set<number>()
  for (const row of rows) {
    const previous = args.signalled.get(row.pid)
    // Force-kill only what already refused a SIGTERM under this exact identity;
    // anything newly seen, or wearing a pid recycled since, starts over at SIGTERM.
    const sameIdentity = previous?.startedAt === row.startedAt && previous.pgid === row.pgid
    if (args.escalate && sameIdentity && hasUnambiguousStartIdentity(row, capturedAtMs)) {
      args.sendSignal(row.pid, 'SIGKILL')
      forcedPgids.add(row.pgid)
      continue
    }
    if (!sameIdentity) {
      args.signalled.set(row.pid, { startedAt: row.startedAt, pgid: row.pgid })
    }
    args.sendSignal(row.pid, 'SIGTERM')
  }
  // A group escalates with its own members, never because a different one did.
  for (const pgid of pgids) {
    args.sendGroupSignal(pgid, forcedPgids.has(pgid) ? 'SIGKILL' : 'SIGTERM')
  }
}
