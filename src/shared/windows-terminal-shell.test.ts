import { describe, expect, it } from 'vitest'
import {
  isSupportedWindowsShellOverride,
  listSupportedWindowsShellOverrides,
  resolveWindowsShellStartupFamily
} from './windows-terminal-shell'

describe('resolveWindowsShellStartupFamily', () => {
  it('defaults to PowerShell when unset', () => {
    expect(resolveWindowsShellStartupFamily(undefined)).toBe('powershell')
    expect(resolveWindowsShellStartupFamily(null)).toBe('powershell')
    expect(resolveWindowsShellStartupFamily('  ')).toBe('powershell')
  })

  it('treats PowerShell and pwsh as PowerShell', () => {
    expect(resolveWindowsShellStartupFamily('powershell.exe')).toBe('powershell')
    expect(resolveWindowsShellStartupFamily('pwsh.exe')).toBe('powershell')
    expect(resolveWindowsShellStartupFamily('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe(
      'powershell'
    )
  })

  it('maps cmd.exe to cmd quoting', () => {
    expect(resolveWindowsShellStartupFamily('cmd.exe')).toBe('cmd')
    expect(resolveWindowsShellStartupFamily('C:\\Windows\\System32\\cmd.exe')).toBe('cmd')
  })

  it('maps Git Bash and WSL shells to POSIX quoting', () => {
    expect(resolveWindowsShellStartupFamily('git-bash')).toBe('posix')
    expect(resolveWindowsShellStartupFamily('wsl.exe')).toBe('posix')
    expect(resolveWindowsShellStartupFamily('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('posix')
  })

  it('maps extension-less bash and wsl entries to POSIX quoting', () => {
    expect(resolveWindowsShellStartupFamily('bash')).toBe('posix')
    expect(resolveWindowsShellStartupFamily('wsl')).toBe('posix')
    expect(resolveWindowsShellStartupFamily('C:\\Program Files\\Git\\bin\\bash')).toBe('posix')
  })
})

describe('isSupportedWindowsShellOverride', () => {
  // Spelled out rather than looped over the list, which would assert the list against itself.
  it('accepts exactly the shells the relay is willing to spawn', () => {
    expect(listSupportedWindowsShellOverrides()).toEqual([
      'bash',
      'bash.exe',
      'cmd',
      'cmd.exe',
      'git-bash',
      'powershell',
      'powershell.exe',
      'pwsh',
      'pwsh.exe',
      'wsl',
      'wsl.exe'
    ])
    expect(isSupportedWindowsShellOverride('cmd.exe')).toBe(true)
    expect(isSupportedWindowsShellOverride('powershell.exe')).toBe(true)
    expect(isSupportedWindowsShellOverride('git-bash')).toBe(true)
  })

  it('accepts a differently cased spelling of an allowed shell', () => {
    expect(isSupportedWindowsShellOverride('CMD.EXE')).toBe(true)
    expect(isSupportedWindowsShellOverride('PowerShell.exe')).toBe(true)
  })

  // The allowlist is what stops `--shell` from naming an arbitrary executable to spawn.
  it('refuses anything else, including a path to an allowed shell', () => {
    expect(isSupportedWindowsShellOverride('nu.exe')).toBe(false)
    expect(isSupportedWindowsShellOverride('')).toBe(false)
    expect(isSupportedWindowsShellOverride('C:\\Windows\\System32\\cmd.exe')).toBe(false)
    expect(isSupportedWindowsShellOverride('cmd.exe /c calc')).toBe(false)
  })
})
