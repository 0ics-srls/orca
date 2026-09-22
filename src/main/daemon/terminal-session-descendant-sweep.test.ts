import { afterEach, describe, expect, it, vi } from 'vitest'
import { sweepTerminalSessionDescendants } from './terminal-session-descendant-sweep'
import { createPtySessionProcessIdentity } from '../pty-session-identity'
import type { ProcessTableCapture } from '../pty-descendant-termination'
import type * as DescendantTermination from '../pty-descendant-termination'

const readProcessTable = vi.hoisted(() => vi.fn<() => Promise<ProcessTableCapture>>())
vi.mock('../pty-descendant-termination', async (importOriginal) => {
  const actual = await importOriginal<typeof DescendantTermination>()
  return { ...actual, readProcessTable, sendDescendantSignal: vi.fn() }
})

const STARTED_AT = 'Mon Jul 13 12:54:47 2026'

describe('terminal session sweep process-table batching', () => {
  afterEach(() => vi.useRealTimers())

  it('shares fresh reads across a simultaneous twenty-terminal teardown', async () => {
    vi.useFakeTimers()
    const rows = Array.from({ length: 20 }, (_, index) => [
      { pid: 100 + index, ppid: 1, pgid: 100 + index, startedAt: STARTED_AT },
      { pid: 200 + index, ppid: 100 + index, pgid: 200 + index, startedAt: STARTED_AT }
    ]).flat()
    readProcessTable
      .mockResolvedValueOnce({ rows, capturedAtMs: Date.now() })
      .mockResolvedValue({ rows: [], capturedAtMs: Date.now() })
    const sweeps = Array.from({ length: 20 }, (_, index) =>
      sweepTerminalSessionDescendants(createPtySessionProcessIdentity({ rootPid: 100 + index }), {
        sendSignal: vi.fn(),
        sendGroupSignal: vi.fn(),
        readTtyTable: async () => null,
        platform: 'darwin',
        selfPid: 999_999
      })
    )
    await vi.advanceTimersByTimeAsync(3_000)

    await expect(Promise.all(sweeps)).resolves.toEqual(Array(20).fill('exited'))
    expect(readProcessTable).toHaveBeenCalledTimes(2)
  })
})
