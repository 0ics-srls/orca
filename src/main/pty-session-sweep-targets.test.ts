import { describe, expect, it } from 'vitest'
import { collectSessionSweepTargets } from './pty-session-sweep-targets'
import {
  createPtySessionProcessIdentity,
  markPtySessionRootExited,
  rememberPtySessionPgids
} from './pty-session-identity'
import type { ProcessTableRow } from './pty-process-table-parser'

const BEFORE = 'Mon Jul 13 12:54:47 2026'
const AFTER = 'Mon Jul 13 12:55:30 2026'
const EXIT_AT_MS = Date.parse('Mon Jul 13 12:55:00 2026')

const ROOT = 500
const SELF = 900

function row(pid: number, ppid: number, pgid: number, startedAt = BEFORE): ProcessTableRow {
  return { pid, ppid, pgid, startedAt }
}

/** Orca's own chain: daemon 900 under app 910 under the user's shell 920. */
const SELF_ROWS = [row(SELF, 910, 900), row(910, 920, 910), row(920, 1, 920)]

function identityFor(opts: { tty?: string; exited?: boolean; pgids?: number[] } = {}) {
  const identity = createPtySessionProcessIdentity({
    rootPid: ROOT,
    ...(opts.tty === undefined ? {} : { slavePath: `/dev/${opts.tty}` })
  })
  identity.rootStartedAt = BEFORE
  rememberPtySessionPgids(identity, opts.pgids ?? [])
  if (opts.exited) {
    markPtySessionRootExited(identity, EXIT_AT_MS)
  }
  return identity
}

function pidsOf(rows: readonly ProcessTableRow[]): number[] {
  return rows.map((entry) => entry.pid).sort((left, right) => left - right)
}

describe('collectSessionSweepTargets', () => {
  it('walks the ppid tree while the root is alive', () => {
    const targets = collectSessionSweepTargets({
      identity: identityFor(),
      rows: [...SELF_ROWS, row(ROOT, 1, ROOT), row(501, ROOT, 501), row(502, 501, 501)],
      selfPid: SELF
    })

    expect(targets.rootAlive).toBe(true)
    expect(pidsOf(targets.rows)).toEqual([501, 502])
    // The root's own group belongs to whoever signals the root.
    expect(targets.pgids).toEqual([501])
  })

  it('refuses the ppid tree once the root has exited, because that pid is now a stranger', () => {
    const targets = collectSessionSweepTargets({
      // A live row wears the vacated pid and has children of its own.
      identity: identityFor({ exited: true }),
      rows: [...SELF_ROWS, row(ROOT, 1, ROOT, AFTER), row(501, ROOT, 501, AFTER)],
      selfPid: SELF
    })

    expect(targets.rootAlive).toBe(false)
    expect(targets.rows).toEqual([])
  })

  it('claims a reparented process by a group the session is known to own', () => {
    const targets = collectSessionSweepTargets({
      identity: identityFor({ exited: true, pgids: [777] }),
      rows: [...SELF_ROWS, row(4767, 1, 777), row(4794, 4767, 777), row(5000, 1, 888)],
      selfPid: SELF
    })

    expect(pidsOf(targets.rows)).toEqual([4767, 4794])
    expect(targets.pgids).toEqual([777])
  })

  it('claims processes left on the session terminal after a natural exit', () => {
    const targets = collectSessionSweepTargets({
      identity: identityFor({ tty: 'ttys003', exited: true }),
      rows: [...SELF_ROWS, row(4767, 1, 777), row(4794, 4767, 777)],
      ttyRows: [row(4767, 1, 777), row(4794, 4767, 777)],
      selfPid: SELF
    })

    expect(pidsOf(targets.rows)).toEqual([4767, 4794])
    expect(targets.pgids).toEqual([777])
  })

  it('ignores a terminal row born after the root died, which a new session may own', () => {
    const targets = collectSessionSweepTargets({
      identity: identityFor({ tty: 'ttys003', exited: true }),
      rows: [...SELF_ROWS, row(6000, 1, 6000, AFTER)],
      ttyRows: [row(6000, 1, 6000, AFTER)],
      selfPid: SELF
    })

    expect(targets.rows).toEqual([])
  })

  it('still claims a post-exit child of a process it recognizes', () => {
    const targets = collectSessionSweepTargets({
      identity: identityFor({ tty: 'ttys003', exited: true }),
      rows: [...SELF_ROWS, row(4767, 1, 777), row(7001, 4767, 7001, AFTER)],
      ttyRows: [row(4767, 1, 777)],
      selfPid: SELF
    })

    expect(pidsOf(targets.rows)).toEqual([4767, 7001])
    expect(targets.pgids.sort((left, right) => left - right)).toEqual([777, 7001])
  })

  it('never targets Orca, an ancestor of Orca, or a group one of them sits in', () => {
    const targets = collectSessionSweepTargets({
      // A group collision puts the user's shell in a group the session owns.
      identity: identityFor({ tty: 'ttys003', exited: true, pgids: [920] }),
      rows: [...SELF_ROWS, row(921, 920, 920)],
      ttyRows: [row(SELF, 910, 900), row(910, 920, 910), row(920, 1, 920), row(921, 920, 920)],
      selfPid: SELF
    })

    expect(targets.rows).toEqual([])
    expect(targets.pgids).toEqual([])
  })

  it('drops the terminal claim entirely when Orca shares that terminal', () => {
    const targets = collectSessionSweepTargets({
      // A development daemon launched from the same terminal as the session.
      identity: identityFor({ tty: 'ttys003', exited: true }),
      rows: [...SELF_ROWS, row(4767, 1, 777)],
      ttyRows: [row(SELF, 910, 900), row(4767, 1, 777)],
      selfPid: SELF
    })

    expect(targets.rows).toEqual([])
  })

  it('refuses a duplicate pid, which a non-atomic read cannot identify', () => {
    const targets = collectSessionSweepTargets({
      identity: identityFor({ exited: true, pgids: [777] }),
      rows: [...SELF_ROWS, row(4767, 1, 777), row(4767, 2, 777, AFTER)],
      selfPid: SELF
    })

    expect(targets.rows).toEqual([])
  })

  it('has nothing to claim when the root is simply absent and nothing was recorded', () => {
    const targets = collectSessionSweepTargets({
      identity: identityFor({ exited: true }),
      rows: [...SELF_ROWS, row(4767, 1, 777)],
      selfPid: SELF
    })

    expect(targets.rows).toEqual([])
  })
})
