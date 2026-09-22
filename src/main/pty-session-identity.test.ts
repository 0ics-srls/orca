import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPtySessionProcessIdentity,
  markPtySessionRootExited,
  observePtySessionTerminal,
  openPtySessionIdentity
} from './pty-session-identity'
import type { ProcessTableRow } from './pty-process-table-parser'

const BORN = 'Mon Jul 13 12:54:47 2026'
const DARWIN: NodeJS.Platform = 'darwin'

function row(pid: number, ppid: number, pgid: number): ProcessTableRow {
  return { pid, ppid, pgid, startedAt: BORN }
}

// Root 500 leads its own group; 610 is a job it backgrounded into group 610;
// 900 merely shares the terminal, launched there by something Orca does not own.
const TERMINAL_ROWS = [row(500, 400, 500), row(610, 500, 610), row(611, 610, 610), row(900, 1, 900)]

describe('observePtySessionTerminal', () => {
  it('records the root and the groups of work traceable to it, not every group on the terminal', () => {
    const identity = createPtySessionProcessIdentity({ rootPid: 500, slavePath: '/dev/ttys003' })
    observePtySessionTerminal(identity, TERMINAL_ROWS)

    expect(identity.rootStartedAt).toBe(BORN)
    expect([...identity.knownPgids].sort()).toEqual([500, 610])
  })

  it('learns nothing once the root has exited', () => {
    const identity = createPtySessionProcessIdentity({ rootPid: 500, slavePath: '/dev/ttys003' })
    markPtySessionRootExited(identity, Date.now())
    observePtySessionTerminal(identity, TERMINAL_ROWS)

    expect(identity.knownPgids.size).toBe(0)
  })
})

describe('openPtySessionIdentity', () => {
  afterEach(() => vi.useRealTimers())

  it('reads the session terminal shortly after spawn so a setsid child is still captured', async () => {
    vi.useFakeTimers()
    const readTtyTable = vi.fn(async () => ({ rows: TERMINAL_ROWS, capturedAtMs: Date.now() }))
    const identity = openPtySessionIdentity(
      { pid: 500, slavePath: '/dev/ttys003' },
      { readTtyTable, delayMs: 750, platform: DARWIN }
    )
    expect(readTtyTable).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(750)
    expect(readTtyTable).toHaveBeenCalledWith('ttys003')
    expect([...identity.knownPgids].sort()).toEqual([500, 610])
  })

  it('reads nothing on Windows or for a session without a terminal', async () => {
    vi.useFakeTimers()
    const readTtyTable = vi.fn(async () => null)
    openPtySessionIdentity(
      { pid: 500, slavePath: '/dev/ttys003' },
      { readTtyTable, platform: 'win32' }
    )
    openPtySessionIdentity({ pid: 501 }, { readTtyTable, platform: DARWIN })
    await vi.advanceTimersByTimeAsync(5_000)

    expect(readTtyTable).not.toHaveBeenCalled()
  })
})
