import type { GlobalSettings } from './global-settings-types'

/** Which login-shell variables a structured native chat child inherits. */
export type NativeChatShellEnvironmentPolicy = {
  inheritAll: boolean
  names: readonly string[]
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The persisted list as a valid, deduplicated name list; anything malformed (hand-edited file) is empty. */
export function normalizeNativeChatShellEnvironmentVariables(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const names: string[] = []
  for (const entry of value) {
    // Validate each saved entry whole; re-splitting would turn "not valid" into two names.
    if (typeof entry === 'string' && ENV_NAME.test(entry) && !names.includes(entry)) {
      names.push(entry)
    }
  }
  return names
}

export function nativeChatShellEnvironmentPolicy(
  settings: Pick<
    GlobalSettings,
    'nativeChatInheritShellEnvironment' | 'nativeChatShellEnvironmentVariables'
  > | null
): NativeChatShellEnvironmentPolicy {
  return {
    inheritAll: settings?.nativeChatInheritShellEnvironment !== false,
    names: normalizeNativeChatShellEnvironmentVariables(
      settings?.nativeChatShellEnvironmentVariables
    )
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
