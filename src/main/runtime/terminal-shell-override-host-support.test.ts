import { describe, expect, it } from 'vitest'
import { terminalShellOverrideRefusal } from './terminal-shell-override-host-support'
import type { ProjectExecutionRuntimeResolution } from '../../shared/project-execution-runtime'

const NO_PROJECT_RUNTIME = undefined

function resolvedRuntime(kind: 'windows-host' | 'wsl'): ProjectExecutionRuntimeResolution {
  return kind === 'wsl'
    ? {
        status: 'resolved',
        runtime: {
          kind: 'wsl',
          hostPlatform: 'wsl',
          distro: 'Ubuntu',
          projectId: 'p1',
          reason: 'project-override',
          cacheKey: 'p1:wsl:Ubuntu'
        }
      }
    : {
        status: 'resolved',
        runtime: {
          kind: 'windows-host',
          hostPlatform: 'win32',
          projectId: 'p1',
          reason: 'project-override',
          cacheKey: 'p1:windows-host'
        }
      }
}

describe('terminalShellOverrideRefusal', () => {
  it('allows a requested shell on a local Windows execution host', () => {
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'cmd.exe',
        connectionId: null,
        platform: 'win32',
        projectRuntime: NO_PROJECT_RUNTIME
      })
    ).toBeNull()
  })

  it('stays out of the way when no shell was requested', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(
        terminalShellOverrideRefusal({
          shellOverride: undefined,
          connectionId: 'ssh-1',
          platform,
          projectRuntime: resolvedRuntime('wsl')
        })
      ).toBeNull()
    }
  })

  // Both of these hosts would otherwise spawn their default shell and report success.
  it('refuses when the spawn happens over SSH', () => {
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'cmd.exe',
        connectionId: 'ssh-1',
        platform: 'win32',
        projectRuntime: NO_PROJECT_RUNTIME
      })?.message
    ).toContain('over SSH')
  })

  it('refuses on a host that has no Windows shells to pick from', () => {
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'cmd.exe',
        connectionId: null,
        platform: 'darwin',
        projectRuntime: NO_PROJECT_RUNTIME
      })?.message
    ).toContain('darwin')
  })

  // `resolveLocalWindowsTerminalRuntimeOptions` rewrites a shell that contradicts the project's
  // execution runtime, which would hand back a terminal running something else entirely — and
  // would quote an agent's startup command for the shell that was asked for, not the one running.
  it('refuses a WSL shell when the project runs its terminals on the Windows host', () => {
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'wsl.exe',
        connectionId: null,
        platform: 'win32',
        projectRuntime: resolvedRuntime('windows-host')
      })?.message
    ).toContain('on the Windows host')
  })

  it('refuses a Windows shell when the project runs its terminals in WSL', () => {
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'cmd.exe',
        connectionId: null,
        platform: 'win32',
        projectRuntime: resolvedRuntime('wsl')
      })?.message
    ).toContain('in WSL')
  })

  it('allows a shell that agrees with the project runtime', () => {
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'wsl.exe',
        connectionId: null,
        platform: 'win32',
        projectRuntime: resolvedRuntime('wsl')
      })
    ).toBeNull()
    expect(
      terminalShellOverrideRefusal({
        shellOverride: 'powershell.exe',
        connectionId: null,
        platform: 'win32',
        projectRuntime: resolvedRuntime('windows-host')
      })
    ).toBeNull()
  })
})
