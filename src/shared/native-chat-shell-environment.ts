import type { GlobalSettings } from './global-settings-types'

/** Which login-shell variables a structured native chat child inherits. */
export type NativeChatShellEnvironmentPolicy = {
  inheritAll: boolean
  names: readonly string[]
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export function nativeChatShellEnvironmentPolicy(
  settings: Pick<
    GlobalSettings,
    'nativeChatInheritShellEnvironment' | 'nativeChatShellEnvironmentVariables'
  > | null
): NativeChatShellEnvironmentPolicy {
  const saved = settings?.nativeChatShellEnvironmentVariables ?? []
  return {
    inheritAll: settings?.nativeChatInheritShellEnvironment !== false,
    // Validate each saved entry whole; re-splitting would turn "not valid" into two names.
    names: saved.filter((name, index) => ENV_NAME.test(name) && saved.indexOf(name) === index)
  }
}

/** Splits on commas, semicolons, and whitespace; drops invalid names and repeats. */
export function parseNativeChatShellEnvironmentNames(draft: string): string[] {
  const names: string[] = []
  for (const token of draft.split(/[\s,;]+/)) {
    if (ENV_NAME.test(token) && !names.includes(token)) {
      names.push(token)
    }
  }
  return names
}
