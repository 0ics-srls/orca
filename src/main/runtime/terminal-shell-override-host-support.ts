import { isWslShellName } from '../../shared/local-windows-terminal-runtime'
import type { ProjectExecutionRuntimeResolution } from '../../shared/project-execution-runtime'

/**
 * Whether the host about to spawn a terminal can honour a requested Windows shell.
 *
 * The whole point of `--shell` is that the caller stops having to guess which shell it got. A host
 * that cannot apply the pick must say so: silently spawning its default shell returns a healthy
 * terminal running something else, which is the exact failure `--shell` exists to remove.
 */
export function terminalShellOverrideRefusal(args: {
  shellOverride: string | undefined
  connectionId: string | null
  platform: NodeJS.Platform
  projectRuntime: ProjectExecutionRuntimeResolution | undefined
}): Error | null {
  if (!args.shellOverride) {
    return null
  }
  if (args.connectionId) {
    // The shell runs on the SSH host, whose platform and installed shells this runtime cannot see.
    return new Error(
      `This workspace runs its terminals over SSH, and Orca cannot apply --shell ${args.shellOverride} there. No terminal was created. Omit --shell, or create the terminal on the execution host itself.`
    )
  }
  if (args.platform !== 'win32') {
    return new Error(
      `--shell ${args.shellOverride} names a Windows shell, and this execution host is ${args.platform}, which spawns the user's login shell. No terminal was created; omit --shell.`
    )
  }
  return projectRuntimeShellConflict(args.shellOverride, args.projectRuntime)
}

/**
 * The project's execution runtime decides which MACHINE the shell runs on, so it outranks a
 * per-terminal pick — and `resolveLocalWindowsTerminalRuntimeOptions` enforces that by rewriting
 * the value: a WSL project forces `wsl.exe`, and a Windows-host project discards a WSL name in
 * favour of the host shell. Either rewrite hands back a terminal running something the caller did
 * not ask for, and it also splits the startup-command quoting from the shell that receives it
 * (POSIX args typed into cmd, or cmd args typed into a WSL shell). Refusing the contradiction is
 * the only answer that keeps the request and the terminal describing the same thing.
 */
function projectRuntimeShellConflict(
  shellOverride: string,
  projectRuntime: ProjectExecutionRuntimeResolution | undefined
): Error | null {
  if (projectRuntime?.status !== 'resolved') {
    return null
  }
  const runsInWsl = projectRuntime.runtime.kind === 'wsl'
  if (runsInWsl === isWslShellName(shellOverride)) {
    return null
  }
  return new Error(
    runsInWsl
      ? `This workspace's project runs its terminals in WSL, so --shell ${shellOverride} cannot be applied. No terminal was created. Use --shell wsl.exe, or change the project's execution runtime.`
      : `This workspace's project runs its terminals on the Windows host, so --shell ${shellOverride} cannot be applied. No terminal was created. Change the project's execution runtime to WSL, or pass a Windows shell.`
  )
}
