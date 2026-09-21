import { describe, expect, it } from 'vitest'
import { shouldPresentTerminalPerfWindow } from './terminal-perf-presentation'

describe('terminal perf window presentation', () => {
  const isolatedDisplay = {
    ORCA_E2E_TERMINAL_PERF_XVFB: '1',
    ORCA_BACKGROUND_LAUNCH: '1',
    GITHUB_ACTIONS: 'true',
    DISPLAY: ':99'
  }

  it.each(['darwin', 'linux', 'win32'])('keeps ordinary %s runs hidden', (platform) => {
    expect(shouldPresentTerminalPerfWindow({}, platform)).toBe(false)
    expect(
      shouldPresentTerminalPerfWindow(
        { ...isolatedDisplay, ORCA_E2E_TERMINAL_PERF_XVFB: '0' },
        platform
      )
    ).toBe(false)
  })

  it('permits the explicit Linux CI display without changing background launch policy', () => {
    expect(shouldPresentTerminalPerfWindow(isolatedDisplay, 'linux')).toBe(true)
  })

  it.each(['darwin', 'win32'])('rejects visible diagnostics on %s', (platform) => {
    expect(() => shouldPresentTerminalPerfWindow(isolatedDisplay, platform)).toThrow('isolated')
  })

  it.each([
    { ...isolatedDisplay, GITHUB_ACTIONS: undefined },
    { ...isolatedDisplay, GITHUB_ACTIONS: 'false' },
    { ...isolatedDisplay, DISPLAY: undefined },
    { ...isolatedDisplay, DISPLAY: '' }
  ])('rejects a missing isolated display: %j', (env) => {
    expect(() => shouldPresentTerminalPerfWindow(env, 'linux')).toThrow('isolated')
  })
})
