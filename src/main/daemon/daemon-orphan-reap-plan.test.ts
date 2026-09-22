import { describe, expect, it } from 'vitest'
import type { ProcessTableRow } from '../pty-process-table-parser'
import {
  collectProtectedAncestry,
  planOrphanReap,
  type OrphanReapPlanInput
} from './daemon-orphan-reap-plan'
import { ptyOwnershipRecordKey, type PtyOwnershipRecord } from './pty-ownership-record'

const NOW = Date.parse('Mon Sep 21 12:00:00 2026')
const ROOT_STARTED_AT = 'Mon Sep 21 09:00:00 2026'
const BEFORE_ROOT = 'Mon Sep 21 08:59:59 2026'
const AFTER_ROOT = 'Mon Sep 21 09:00:05 2026'

// Defaults describe a leftover: reparented to init, in its own group, started after the root.
function row(overrides: Partial<ProcessTableRow> & { pid: number }): ProcessTableRow {
  return { ppid: 1, pgid: overrides.pid, startedAt: AFTER_ROOT, ...overrides }
}

function record(overrides: Partial<PtyOwnershipRecord> = {}): PtyOwnershipRecord {
  return {
    sessionId: 'session-a',
    incarnationId: 'inc-1',
    root: { pid: 500, startedAt: ROOT_STARTED_AT },
    pgids: [500],
    tty: 'ttys004',
    // The reconciler never correlates on tty; it is carried for the per-session sweeps, which can
    // afford a `ps -t` selection that a whole-host capture cannot.
    daemon: { pid: 400, startedAtMs: Date.parse('Mon Sep 21 08:59:00 2026') },
    recordedAt: NOW - 10 * 60_000,
    ...overrides
  }
}

function plan(overrides: Partial<OrphanReapPlanInput> = {}) {
  return planOrphanReap({
    records: [record()],
    liveSessions: [],
    table: [],
    selfPid: 900,
    pendingConfirmations: new Set<string>(),
    nowMs: NOW,
    spawnGraceMs: 60_000,
    maxRecordAgeMs: 24 * 60 * 60_000,
    daemonStartToleranceMs: 5_000,
    ...overrides
  })
}

const KEY = ptyOwnershipRecordKey('session-a', 'inc-1')

describe('planOrphanReap', () => {
  it('never reaps a record backed by a live session, and re-derives its groups', () => {
    const result = plan({
      liveSessions: [{ sessionId: 'session-a', incarnationId: 'inc-1' }],
      table: [
        row({ pid: 500, ppid: 900, pgid: 500, startedAt: ROOT_STARTED_AT }),
        // A child that moved itself into its own group: reachable only while the root is alive.
        row({ pid: 601, ppid: 500, pgid: 601 })
      ]
    })

    expect(result.reap).toEqual([])
    expect(result.confirmNext).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['live_session'])
    expect(result.refreshed[0].pgids.sort()).toEqual([500, 601])
    expect(result.refreshed[0].recordedAt).toBe(NOW)
  })

  it('protects every generation of a session whose live generation is unreported', () => {
    const result = plan({
      records: [record({ incarnationId: 'inc-1' }), record({ incarnationId: 'inc-2' })],
      // An older protocol can report a live session without naming its generation.
      liveSessions: [{ sessionId: 'session-a' }],
      table: [row({ pid: 601, pgid: 500 })],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['live_session', 'live_session'])
  })

  it('requires two consecutive observations before signalling an orphaned group', () => {
    const table = [row({ pid: 601, pgid: 500 })]

    const first = plan({ table })
    expect(first.reap).toEqual([])
    expect(first.confirmNext).toEqual([KEY])
    expect(first.skipped.map((entry) => entry.reason)).toEqual(['awaiting_second_observation'])

    const second = plan({ table, pendingConfirmations: new Set([KEY]) })
    expect(second.reap).toHaveLength(1)
    expect(second.reap[0].reason).toBe('orphaned_group')
    expect(second.reap[0].members.map((member) => member.pid)).toEqual([601])
    // Kept pending so a kill that does not land is retried rather than restarting the clock.
    expect(second.confirmNext).toEqual([KEY])
  })

  it('reaps a root that survived its daemon, root included, once confirmed', () => {
    const table = [
      row({ pid: 500, pgid: 500, startedAt: ROOT_STARTED_AT }),
      row({ pid: 601, pgid: 500 })
    ]

    const result = plan({ table, pendingConfirmations: new Set([KEY]) })

    expect(result.reap).toHaveLength(1)
    expect(result.reap[0].reason).toBe('stranded_root')
    expect(result.reap[0].members.map((member) => member.pid).sort()).toEqual([500, 601])
  })

  it('refuses a recycled group whose members predate the recorded root', () => {
    const result = plan({
      table: [row({ pid: 601, pgid: 500, startedAt: BEFORE_ROOT })],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap).toEqual([])
    expect(result.dropped).toEqual([{ key: KEY, sessionId: 'session-a', reason: 'unclaimable' }])
  })

  it('refuses a group still held together by a live parent outside it', () => {
    const result = plan({
      table: [
        row({ pid: 700, pgid: 700 }),
        // Reusing pgid 500, but parented by a process that is neither init, this daemon, nor a
        // member — someone else is still running this tree.
        row({ pid: 601, ppid: 700, pgid: 500 })
      ],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap).toEqual([])
    expect(result.dropped).toEqual([{ key: KEY, sessionId: 'session-a', reason: 'unclaimable' }])
  })

  it('accepts a group whose members are parented by each other', () => {
    const result = plan({
      table: [row({ pid: 601, pgid: 500 }), row({ pid: 602, ppid: 601, pgid: 500 })],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap[0].members.map((member) => member.pid).sort()).toEqual([601, 602])
  })

  it('refuses a record whose root pid is live under a different identity', () => {
    const result = plan({
      table: [row({ pid: 500, pgid: 500, startedAt: AFTER_ROOT })],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['root_pid_reused'])
  })

  it('never signals a group that belongs to the daemon own ancestry', () => {
    const result = plan({
      records: [record({ pgids: [800] })],
      // 900 is the daemon; 800 is its parent and the group both share.
      table: [
        row({ pid: 900, ppid: 800, pgid: 800 }),
        row({ pid: 800, pgid: 800 }),
        row({ pid: 601, pgid: 800 })
      ],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['protected_ancestry'])
  })

  it('leaves another live daemon records alone', () => {
    const result = plan({
      table: [
        row({ pid: 400, pgid: 400, startedAt: 'Mon Sep 21 08:59:00 2026' }),
        row({ pid: 601, pgid: 500 })
      ],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['owning_daemon_alive'])
  })

  it('holds off on a record younger than the spawn grace', () => {
    const result = plan({
      records: [record({ recordedAt: NOW - 5_000 })],
      table: [row({ pid: 601, pgid: 500 })],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['within_spawn_grace'])
  })

  it('refuses to signal a record that never captured a root start time', () => {
    const result = plan({
      records: [record({ root: { pid: 500, startedAt: null } })],
      table: [row({ pid: 601, pgid: 500 })],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['no_root_identity'])
  })

  it('retires a record whose root and groups are all gone', () => {
    const result = plan({ table: [row({ pid: 999, pgid: 999 })] })

    expect(result.dropped).toEqual([{ key: KEY, sessionId: 'session-a', reason: 'settled' }])
    expect(result.confirmNext).toEqual([])
  })

  it('expires a record that outlived its bounded age even while processes remain', () => {
    const result = plan({
      records: [record({ recordedAt: NOW - 25 * 60 * 60_000 })],
      table: [row({ pid: 601, pgid: 500 })],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap).toEqual([])
    expect(result.dropped).toEqual([{ key: KEY, sessionId: 'session-a', reason: 'expired' }])
  })

  it('keys records by incarnation so a respawn does not inherit the previous generation debt', () => {
    const result = plan({
      records: [record({ incarnationId: 'inc-1' }), record({ incarnationId: 'inc-2' })],
      liveSessions: [{ sessionId: 'session-a', incarnationId: 'inc-2' }],
      table: [
        row({ pid: 500, pgid: 500, startedAt: ROOT_STARTED_AT }),
        row({ pid: 601, pgid: 500 })
      ],
      pendingConfirmations: new Set([KEY])
    })

    expect(result.reap.map((target) => target.incarnationId)).toEqual(['inc-1'])
    expect(result.refreshed.map((entry) => entry.incarnationId)).toEqual(['inc-2'])
  })
})

describe('collectProtectedAncestry', () => {
  it('walks the parent chain and collects every group along it', () => {
    const table = [
      row({ pid: 900, ppid: 800, pgid: 890 }),
      row({ pid: 800, ppid: 700, pgid: 800 }),
      row({ pid: 700, pgid: 700 })
    ]

    const protectedAncestry = collectProtectedAncestry(table, 900)

    expect([...protectedAncestry.pids].sort()).toEqual([700, 800, 900])
    expect([...protectedAncestry.pgids].sort()).toEqual([0, 1, 700, 800, 890])
  })

  it('terminates on a parent cycle a non-atomic capture can produce', () => {
    const table = [row({ pid: 900, ppid: 800 }), row({ pid: 800, ppid: 900 })]

    expect([...collectProtectedAncestry(table, 900).pids].sort()).toEqual([800, 900])
  })
})
