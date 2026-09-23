import { describe, expect, it, vi } from 'vitest'
import { detectRuntimeMachineName, RuntimeMachineName } from './runtime-machine-name'

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

  it('answers with the detected name once the one-time lookup lands', async () => {
    const machine = new RuntimeMachineName(() => undefined)
    machine.start()
    const expected = await detectRuntimeMachineName()
    await vi.waitFor(() => expect(machine.read()).toBe(expected))
  })

  it('prefers a configured name and falls back to the detected name', async () => {
    let configured: string | undefined
    const machine = new RuntimeMachineName(() => configured)
    expect(machine.read()).toBeTypeOf('string')
    configured = '  Build server  '
    expect(machine.read()).toBe('Build server')
  })
})
