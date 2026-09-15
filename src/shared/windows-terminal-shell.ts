import type { AgentStartupShell } from './tui-agent-startup-shell'

export const WINDOWS_GIT_BASH_SHELL = 'git-bash'

export type BuiltInWindowsTerminalShell =
  | 'powershell.exe'
  | 'cmd.exe'
  | 'wsl.exe'
  | typeof WINDOWS_GIT_BASH_SHELL

/**
 * Classifies a configured `terminalWindowsShell` value into the startup-shell
 * family used to quote queued commands. Git Bash / wsl.exe run a POSIX shell;
 * cmd.exe needs cmd quoting; everything else (PowerShell, pwsh, unknown) is
 * treated as PowerShell, matching the Windows default.
 */
export function resolveWindowsShellStartupFamily(
  shell: string | null | undefined
): AgentStartupShell {
  const trimmed = shell?.trim()
  if (!trimmed) {
    return 'powershell'
  }
  if (trimmed === WINDOWS_GIT_BASH_SHELL) {
    return 'posix'
  }
  const basename = trimmed.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? ''
  if (basename === 'cmd.exe') {
    return 'cmd'
  }
  // Why: wsl.exe and bash.exe (Git for Windows) launch POSIX shells, so queued
  // commands must use POSIX quoting and `cd '<cwd>'` rather than cmd/PowerShell.
  // Extension-less forms reach the same executables through PATHEXT.
  if (
    basename === 'wsl.exe' ||
    basename === 'wsl' ||
    basename === 'bash.exe' ||
    basename === 'bash'
  ) {
    return 'posix'
  }
  return 'powershell'
}

export function resolveLocalWindowsAgentStartupShell(args: {
  platform: NodeJS.Platform
  isRemote: boolean
  terminalWindowsShell?: string | null
}): AgentStartupShell | undefined {
  // Why: terminalWindowsShell describes the local host shell; SSH/remote
  // targets need their own shell signal before we can safely override quoting.
  if (args.platform !== 'win32' || args.isRemote) {
    return undefined
  }
  return resolveWindowsShellStartupFamily(args.terminalWindowsShell)
}

/**
 * Shell names a caller may request for a single Windows terminal.
 *
 * The relay owns the spawn and has always refused anything outside this set, but the set lived
 * only there — so a bad value from `terminal create --shell` surfaced as a spawn-time throw with
 * no way for the CLI to answer before the round trip. Shared so the RPC boundary and the relay
 * agree on the same names.
 */
const WINDOWS_SHELL_OVERRIDES: ReadonlySet<string> = new Set([
  'powershell.exe',
  'powershell',
  'pwsh.exe',
  'pwsh',
  'cmd.exe',
  'cmd',
  'wsl.exe',
  'wsl',
  // Why: both spellings classify as a POSIX startup family, so rejecting them here made the relay
  // the one host that hard-failed a setting the local and daemon PTYs accept.
  'bash.exe',
  'bash',
  WINDOWS_GIT_BASH_SHELL
])

export function isSupportedWindowsShellOverride(shell: string): boolean {
  return WINDOWS_SHELL_OVERRIDES.has(shell.toLowerCase())
}

/** Sorted for a stable error message; callers list these when refusing a value. */
export function listSupportedWindowsShellOverrides(): string[] {
  return [...WINDOWS_SHELL_OVERRIDES].sort()
}
