import type { AgentStartupShell } from './tui-agent-startup-shell'

/**
 * Git Bash on Windows does not execute `muse.cmd`. When `muse` is already a
 * binary (Linux, WSL, macOS) run it directly; otherwise hand the same argv to
 * `cmd //c`, which keeps a console and does not let MSYS rewrite `/c`.
 */
export function wrapMuseWindowsPosixLaunch(command: string): string {
  return `if command -v muse >/dev/null 2>&1; then exec ${command}; else cmd //c ${command}; fi`
}

export function finalizeMuseLaunchCommand(args: {
  agent: string
  command: string
  platform: NodeJS.Platform
  shell: AgentStartupShell
}): string {
  if (args.agent === 'muse' && args.platform === 'win32' && args.shell === 'posix') {
    return wrapMuseWindowsPosixLaunch(args.command)
  }
  return args.command
}
