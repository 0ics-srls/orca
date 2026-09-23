import { basename } from 'node:path'
import { resolveDefaultShell } from './pty-shell-utils'
import { buildCapturedShellCommand } from '../shared/wsl-login-shell-command'

export function agentExecLoginShell(
  binary: string,
  args: string[],
  cwd: string | undefined,
  requested: unknown
): { spawnCmd: string; spawnArgs: string[]; readStdout: (stdout: string) => string | null } | null {
  if (process.platform === 'win32' || requested !== true) {
    return null
  }
  const shell = resolveDefaultShell()
  if (!['bash', 'zsh'].includes(basename(shell).toLowerCase())) {
    return null
  }

  const captured = buildCapturedShellCommand('cd -- "$1" || exit; shift; exec "$@"')
  return {
    spawnCmd: shell,
    spawnArgs: ['-ilc', captured.command, 'orca-agent', cwd ?? process.cwd(), binary, ...args],
    readStdout: captured.readStdout
  }
}
