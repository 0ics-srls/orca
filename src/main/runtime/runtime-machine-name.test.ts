import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { normalizeMachineName } from '../../shared/machine-name'
import { detectRuntimeMachineName, RuntimeMachineName } from './runtime-machine-name'

// Why mocked: the shared lookup is the one path that spawns the real `scutil`; a live spawn on a
// loaded macOS runner can hit the 1 s timeout and answer with the hostname while a second live
// spawn does not, which is a flake and not a verdict.
const runProcessMock = vi.hoisted(() => vi.fn())
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: runProcessMock }))

describe('runtime machine name detection', () => {
  it('uses the hostname on non-macOS without starting a subprocess', async () => {
    const run = vi.fn()
    await expect(
      detectRuntimeMachineName({ platform: 'linux', fallback: 'linux-host', run })
    ).resolves.toBe('linux-host')
    expect(run).not.toHaveBeenCalled()
  })

  it('uses the macOS friendly computer name when scutil succeeds', async () => {
    const run = vi.fn().mockResolvedValue({
      code: 0,
      signal: null,
      stdout: 'M4 Air\n',
      stderr: '',
      timedOut: false
    })
    await expect(
      detectRuntimeMachineName({ platform: 'darwin', fallback: 'm4-air.local', run })
    ).resolves.toBe('M4 Air')
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ program: '/usr/sbin/scutil', args: ['--get', 'ComputerName'] })
    )
  })

  it('falls back when macOS name lookup fails or returns no name', async () => {
    await expect(
      detectRuntimeMachineName({
        platform: 'darwin',
        fallback: 'm4-air.local',
        run: vi.fn().mockResolvedValue({
          code: 1,
          signal: null,
          stdout: '',
          stderr: 'could not read',
          timedOut: false
        })
      })
    ).resolves.toBe('m4-air.local')
    await expect(
      detectRuntimeMachineName({
        platform: 'darwin',
        fallback: 'm4-air.local',
        run: vi.fn().mockRejectedValue(new Error('spawn failed'))
      })
    ).resolves.toBe('m4-air.local')
  })

  it('answers with the hostname until the one shared lookup lands', async () => {
    let finishLookup: ((value: unknown) => void) | undefined
    runProcessMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve
        })
    )
    const hostname = normalizeMachineName(os.hostname())
    const first = new RuntimeMachineName(() => undefined)
    const second = new RuntimeMachineName(() => undefined)
    first.start()
    second.start()
    first.start()

    expect(first.read()).toBe(hostname)
    expect(second.read()).toBe(hostname)
    if (process.platform !== 'darwin') {
      expect(runProcessMock).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(first.read()).toBe(hostname))
      return
    }
    // Every runtime in the process shares one lookup; the second `start` must not spawn again.
    expect(runProcessMock).toHaveBeenCalledTimes(1)
    finishLookup?.({
      code: 0,
      signal: null,
      stdout: 'Friendly Name\n',
      stderr: '',
      timedOut: false
    })
    await vi.waitFor(() => expect(first.read()).toBe('Friendly Name'))
    expect(second.read()).toBe('Friendly Name')
    expect(runProcessMock).toHaveBeenCalledTimes(1)
  })

  it('prefers a configured name and falls back to the detected name', async () => {
    let configured: string | undefined
    const machine = new RuntimeMachineName(() => configured)
    expect(machine.read()).toBeTypeOf('string')
    configured = '  Build server  '
    expect(machine.read()).toBe('Build server')
  })
})
