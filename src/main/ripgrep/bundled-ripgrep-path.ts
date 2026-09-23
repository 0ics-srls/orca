import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'
import { quotePosixShell } from '../../shared/wsl-login-shell-command'
import {
  BUNDLED_RIPGREP_PACKAGE_BIN_DIR,
  BUNDLED_RIPGREP_RESOURCE_DIR,
  bundledRipgrepBinaryName,
  toBundledRipgrepPlatform,
  type BundledRipgrepPlatform
} from '../../shared/bundled-ripgrep'

const resolvedPaths = new Map<BundledRipgrepPlatform, string | null>()

function candidatePaths(platform: BundledRipgrepPlatform): string[] {
  const binaryName = bundledRipgrepBinaryName(platform)
  const candidates: string[] = []
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, BUNDLED_RIPGREP_RESOURCE_DIR, platform, binaryName))
  }
  // Why not packaged: a packaged app must never run a binary from whatever checkout it was launched in.
  if (hasAppEnvironment() && getAppEnvironment().isPackaged()) {
    return candidates
  }
  // Why: development and test hosts run from a checkout where only node_modules holds the binaries.
  const roots = [hasAppEnvironment() ? getAppEnvironment().getAppPath() : null, process.cwd()]
  for (const root of roots) {
    if (root) {
      candidates.push(join(root, BUNDLED_RIPGREP_PACKAGE_BIN_DIR, platform, binaryName))
    }
  }
  return candidates
}

/** Absolute path to Orca's own ripgrep for `platform`, or null when this install lacks it. */
export function resolveBundledRipgrepPath(platform: BundledRipgrepPlatform): string | null {
  if (!resolvedPaths.has(platform)) {
    const found = candidatePaths(platform).find((path) => existsSync(path))
    // Why realpath: dev checkouts reach the package through pnpm symlinks, which SSH uploads reject.
    resolvedPaths.set(platform, found ? realpathSync(found) : null)
  }
  return resolvedPaths.get(platform) ?? null
}

/**
 * The rg command for a local spawn: this host's bundled binary, or its Linux build when the
 * spawn is routed into WSL. Falls back to PATH only for a damaged or unpackaged install.
 */
export function bundledRipgrepCommand(options: { wsl?: boolean } = {}): string {
  const platform = options.wsl
    ? toBundledRipgrepPlatform('linux', process.arch)
    : toBundledRipgrepPlatform(process.platform, process.arch)
  return (platform && resolveBundledRipgrepPath(platform)) ?? 'rg'
}

/**
 * Spawn options for a WSL-routed rg: inside the distro, pick the Linux build matching its own
 * architecture (Windows-on-ARM runs x64 Orca beside arm64 distros) from the Windows install via
 * wslpath (custom automount roots), else the distro's own rg when the install drive is not mounted.
 */
export function bundledRipgrepWslSpawnOptions(command: string): { wslShellCommand?: string } {
  const ripgrepRoot = command.replace(/[\\/][^\\/]+[\\/][^\\/]+$/, '')
  if (command === 'rg' || ripgrepRoot === command) {
    return {}
  }
  return {
    wslShellCommand: `"$(d=$(wslpath -u ${quotePosixShell(ripgrepRoot)} 2>/dev/null); case "$(uname -m)" in aarch64|arm64) a=linux-arm64;; *) a=linux-x64;; esac; if [ -n "$d" ] && [ -x "$d/$a/rg" ]; then printf %s "$d/$a/rg"; else printf rg; fi)"`
  }
}

export function resetBundledRipgrepPathCacheForTests(): void {
  resolvedPaths.clear()
}

// Why no git/readdir fallback: VS Code ships the same contract — a bundled rg that cannot start
// means a damaged install or security-software block, which a slower partial listing would hide.
export function bundledRipgrepUnavailableError(): Error {
  return new Error(
    "Orca's bundled search tool (ripgrep) could not start. Reinstall Orca, or allow it in your security software."
  )
}
