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
  return null
}
