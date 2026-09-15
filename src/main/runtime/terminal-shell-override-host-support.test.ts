import { describe, expect, it } from 'vitest'
import { terminalShellOverrideRefusal } from './terminal-shell-override-host-support'

describe('terminalShellOverrideRefusal', () => {
  it('allows a requested shell on a local Windows execution host', () => {
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'cmd.exe',
        connectionId: null,
        platform: 'win32'
      })
    ).toBeNull()
  })

  it('stays out of the way when no shell was requested', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(
        terminalShellOverrideRefusal({ shellOverride: undefined, connectionId: 'ssh-1', platform })
      ).toBeNull()
    }
  })

  // Both of these hosts would otherwise spawn their default shell and report success.
  it('refuses when the spawn happens over SSH', () => {
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'cmd.exe',
        connectionId: 'ssh-1',
        platform: 'win32'
      })?.message
    ).toContain('over SSH')
  })

  it('refuses on a host that has no Windows shells to pick from', () => {
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'cmd.exe',
        connectionId: null,
        platform: 'darwin'
      })?.message
    ).toContain('darwin')
  })
})
