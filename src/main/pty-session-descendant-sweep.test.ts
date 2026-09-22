import { afterEach, describe, expect, it, vi } from 'vitest'
import { sweepSessionDescendants } from './pty-session-descendant-sweep'
import {
  createPtySessionProcessIdentity,
  markPtySessionRootExited,
  rememberPtySessionPgids
} from './pty-session-identity'
import type { ProcessTableCapture, ProcessTableRow } from './pty-descendant-termination'

const DARWIN: NodeJS.Platform = 'darwin'
const BORN = 'Mon Jul 13 12:54:47 2026'
const EXIT_AT_MS = Date.parse('Mon Jul 13 12:55:00 2026')
const CAPTURED_AT_MS = Date.parse('Mon Jul 13 12:56:00 2026')

function row(pid: number, ppid: number, pgid: number): ProcessTableRow {
  return { pid, ppid, pgid, startedAt: BORN }
}

function capture(rows: ProcessTableRow[]): ProcessTableCapture {
  return { rows, capturedAtMs: CAPTURED_AT_MS }
}

function exitedIdentity(pgids: number[] = [777]) {
  const identity = createPtySessionProcessIdentity({ rootPid: 500, slavePath: '/dev/ttys003' })
  identity.rootStartedAt = BORN
  rememberPtySessionPgids(identity, pgids)
  markPtySessionRootExited(identity, EXIT_AT_MS)
  return identity
}

function sweepHarness(tables: ProcessTableCapture[]) {
  const signals: string[] = []
  const readTable = vi.fn(async () => tables.shift() ?? capture([]))
  return {
    signals,
    readTable,
    deps: {
      readTable,
      readTtyTable: async () => null,
      sendSignal: (pid: number, signal: NodeJS.Signals) => signals.push(`${signal} ${pid}`),
      sendGroupSignal: (pgid: number, signal: NodeJS.Signals) => signals.push(`${signal} -${pgid}`),
      platform: DARWIN,
      selfPid: 900
    }
  }
}

describe('sweepSessionDescendants', () => {
  afterEach(() => vi.useRealTimers())

  it('signals the recorded group and its members, then reports them gone', async () => {
    vi.useFakeTimers()
    const harness = sweepHarness([capture([row(4767, 1, 777), row(4794, 4767, 777)])])
    const pending = sweepSessionDescendants(exitedIdentity(), harness.deps)
    await vi.advanceTimersByTimeAsync(500)

    await expect(pending).resolves.toBe('exited')
    expect(harness.signals).toEqual(['SIGTERM 4767', 'SIGTERM 4794', 'SIGTERM -777'])
  })

  it('escalates a survivor to SIGKILL only after the grace window', async () => {
    vi.useFakeTimers()
    const survivor = capture([row(4767, 1, 777)])
    const harness = sweepHarness(Array.from({ length: 40 }, () => survivor))
    const pending = sweepSessionDescendants(exitedIdentity(), {
      ...harness.deps,
      graceMs: 400,
      verifyMs: 800
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(harness.signals).not.toContain('SIGKILL 4767')

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(pending).resolves.toBe('live')
    expect(harness.signals).toContain('SIGKILL 4767')
    expect(harness.signals).toContain('SIGKILL -777')
  })

  it('re-targets each round, so a process forked mid-sweep is signalled too', async () => {
    vi.useFakeTimers()
    const harness = sweepHarness([
      capture([row(4767, 1, 777)]),
      capture([row(4767, 1, 777), row(9100, 4767, 777)]),
      capture([])
    ])
    const pending = sweepSessionDescendants(exitedIdentity(), harness.deps)
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toBe('exited')
    expect(harness.signals).toContain('SIGTERM 9100')
  })

  it('gives a pid whose identity changed a fresh SIGTERM before any force-kill', async () => {
    vi.useFakeTimers()
    const recycled: ProcessTableRow = {
      pid: 4767,
      ppid: 1,
      pgid: 777,
      startedAt: 'Mon Jul 13 12:55:50 2026'
    }
    const harness = sweepHarness([
      capture([row(4767, 1, 777)]),
      ...Array.from({ length: 20 }, () => capture([recycled]))
    ])
    const pending = sweepSessionDescendants(exitedIdentity(), {
      ...harness.deps,
      graceMs: 0,
      verifyMs: 500
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await pending

    const terms = harness.signals.filter((entry) => entry === 'SIGTERM 4767')
    expect(terms.length).toBeGreaterThanOrEqual(2)
    // The first volley answered a different process; this identity is asked to stop first.
    expect(harness.signals.indexOf('SIGKILL 4767')).toBeGreaterThan(
      harness.signals.lastIndexOf('SIGTERM 4767')
    )
  })

  it('never force-kills a pid born in the second the table was captured', async () => {
    vi.useFakeTimers()
    // ps reports whole seconds, so this identity cannot be told from a pid reused inside it.
    const birthSecond: ProcessTableRow = {
      pid: 4767,
      ppid: 1,
      pgid: 777,
      startedAt: 'Mon Jul 13 12:56:00 2026'
    }
    const harness = sweepHarness(Array.from({ length: 20 }, () => capture([birthSecond])))
    const pending = sweepSessionDescendants(exitedIdentity(), {
      ...harness.deps,
      graceMs: 0,
      verifyMs: 500
    })
    await vi.advanceTimersByTimeAsync(1_000)

    await pending
    expect(harness.signals).not.toContain('SIGKILL 4767')
  })

  it('reports an unreadable process table as unverifiable, never as exited', async () => {
    vi.useFakeTimers()
    const harness = sweepHarness([])
    const pending = sweepSessionDescendants(exitedIdentity(), {
      ...harness.deps,
      readTable: vi.fn(async () => {
        throw new Error('ps failed')
      }),
      verifyMs: 300
    })
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toBe('unverifiable')
  })

  it('does nothing on Windows, where the pty job object owns the tree', async () => {
    const harness = sweepHarness([capture([row(4767, 1, 777)])])
    await expect(
      sweepSessionDescendants(exitedIdentity(), { ...harness.deps, platform: 'win32' })
    ).resolves.toBe('exited')
    expect(harness.readTable).not.toHaveBeenCalled()
  })

  it('reads nothing for a session that never recorded a terminal or a group', async () => {
    const identity = createPtySessionProcessIdentity({ rootPid: 500 })
    markPtySessionRootExited(identity, EXIT_AT_MS)
    const harness = sweepHarness([capture([row(4767, 1, 777)])])

    await expect(sweepSessionDescendants(identity, harness.deps)).resolves.toBe('exited')
    expect(harness.readTable).not.toHaveBeenCalled()
  })

  it('settles a session whose terminal is empty without reading the whole host table', async () => {
    const harness = sweepHarness([capture([row(4767, 1, 777)])])

    await expect(
      sweepSessionDescendants(exitedIdentity([]), {
        ...harness.deps,
        readTtyTable: async () => capture([])
      })
    ).resolves.toBe('exited')
    expect(harness.readTable).not.toHaveBeenCalled()
  })

  it('still reads the host table when something remains on the terminal', async () => {
    vi.useFakeTimers()
    const harness = sweepHarness([capture([])])
    const pending = sweepSessionDescendants(exitedIdentity([]), {
      ...harness.deps,
      readTtyTable: async () => capture([row(4767, 1, 4767)])
    })
    await vi.advanceTimersByTimeAsync(10_000)
    await pending

    expect(harness.readTable).toHaveBeenCalled()
  })
})
