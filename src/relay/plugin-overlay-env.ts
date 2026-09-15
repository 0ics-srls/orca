import { readSessionShellStartupEnvVar } from '../main/pty/shell-startup-env'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  PRIMARY_AGENT_DIR_ENV_BY_KIND,
  SOURCE_AGENT_DIR_ENV_BY_KIND,
  type PiAgentKind
} from '../shared/pi-agent-kind'

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => typeof value === 'string' && value.length > 0)
}

function readStartupEnv(
  name: string,
  env: Record<string, string>,
  shell: string | undefined
): string | undefined {
  // Why the session env first: it is closer to the user's shell than the relay
  // process env, and fish config lives under its XDG_CONFIG_HOME.
  return readSessionShellStartupEnvVar(name, env, shell)
}

export function resolveOpenCodeSourceConfigDir(
  env: Record<string, string>,
  shell: string | undefined
): string | undefined {
  return firstNonEmpty(
    env.ORCA_OPENCODE_SOURCE_CONFIG_DIR,
    readStartupEnv('OPENCODE_CONFIG_DIR', env, shell),
    env.OPENCODE_CONFIG_DIR
  )
}

export function resolvePiSourceAgentDir(
  env: Record<string, string>,
  shell: string | undefined,
  kind: PiAgentKind,
  launchCommand?: string
): string | undefined {
  const sourceKey = SOURCE_AGENT_DIR_ENV_BY_KIND[kind]
  const primaryKey = PRIMARY_AGENT_DIR_ENV_BY_KIND[kind]

  const ompProfile =
    kind === 'omp'
      ? [readOmpProfileFromCommand(launchCommand), env.OMP_PROFILE, env.PI_PROFILE].find(
          (candidate) => candidate !== undefined && isSafeOmpProfile(candidate)
        )
      : undefined

  if (kind === 'omp' && ompProfile) {
    const configuredRoot = firstNonEmpty(
      env.PI_CONFIG_DIR,
      readStartupEnv('PI_CONFIG_DIR', env, shell)
    )
    const configDir = configuredRoot ?? join(env.HOME ?? process.env.HOME ?? homedir(), '.omp')
    return join(configDir, 'profiles', ompProfile, 'agent')
  }

  const sourceDir = firstNonEmpty(env[sourceKey])
  if (sourceDir) {
    return sourceDir
  }

  const startupDir = readStartupEnv(primaryKey, env, shell)
  if (startupDir) {
    return startupDir
  }

  if (kind === 'prime-agent') {
    return firstNonEmpty(env[primaryKey])
  }

  const overlayKey = kind === 'omp' ? 'ORCA_OMP_CODING_AGENT_DIR' : 'ORCA_PI_CODING_AGENT_DIR'
  const otherOverlayKey = kind === 'omp' ? 'ORCA_PI_CODING_AGENT_DIR' : 'ORCA_OMP_CODING_AGENT_DIR'

  // Why: a mismatched Orca overlay shadow means this shell inherited the other
  // Pi-compatible agent's PTY overlay. Do not remirror that overlay into this
  // launch; let plugin-overlay default to the selected kind's own home dir.
  if (
    env[primaryKey] &&
    env[primaryKey] !== env[overlayKey] &&
    env[primaryKey] !== env[otherOverlayKey]
  ) {
    return env[primaryKey]
  }

  // OMP resolves its agent directory from PI_CONFIG_DIR before it populates
  // PI_CODING_AGENT_DIR. Resolve the launch profile up front so the relay
  // materializes the extension where the remote OMP process will load it.
  if (kind === 'omp') {
    const configuredRoot = firstNonEmpty(
      env.PI_CONFIG_DIR,
      readStartupEnv('PI_CONFIG_DIR', env, shell)
    )
    if (configuredRoot) {
      return join(configuredRoot, 'agent')
    }
    if (launchCommand?.trim()) {
      return join(env.HOME ?? process.env.HOME ?? homedir(), '.omp', 'agent')
    }
  }
  return undefined
}

function readOmpProfileFromCommand(command: string | undefined): string | undefined {
  const match = command?.match(/(?:^|\s)--profile(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/)
  const profile = match?.[1] ?? match?.[2] ?? match?.[3]
  return profile && isSafeOmpProfile(profile) ? profile : undefined
}

function isSafeOmpProfile(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
}

/** Carry shell-selected XDG roots into relay-spawned daemon children. */
export function inheritOmpXdgEnvironment(
  env: Record<string, string>,
  shell: string | undefined
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const name of ['XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'] as const) {
    if (env[name] !== undefined) {
      continue
    }
    const value = readStartupEnv(name, env, shell) ?? process.env[name]
    if (value) {
      next[name] = value
    }
  }
  return next
}
