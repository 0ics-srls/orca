import type { HookCommandConfig, HooksConfig } from '../agent-hooks/installer-utils'
import { removeManagedCommands, buildManagedCommandHook } from '../agent-hooks/installer-utils'

export const AUGGIE_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'PromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop'
] as const

export function applyAuggieManagedHooks(source: HooksConfig, command: string): HooksConfig {
  const hooks = { ...source.hooks }
  for (const event of AUGGIE_HOOK_EVENTS) {
    const current = Array.isArray(hooks[event]) ? hooks[event] : []
    const retained = removeManagedCommands(
      current,
      (candidate) =>
        candidate !== undefined && (candidate === command || candidate.includes('aug-hook.'))
    )
    hooks[event] = [{ hooks: [buildManagedCommandHook(command, 10_000)] }]
    if (retained.length > 0) {
      hooks[event] = [...retained, ...hooks[event]]
    }
  }
  return { ...source, hooks }
}

export function removeAuggieManagedHooks(source: HooksConfig): HooksConfig {
  const hooks = { ...source.hooks }
  for (const event of AUGGIE_HOOK_EVENTS) {
    const current = Array.isArray(hooks[event]) ? hooks[event] : []
    const retained = removeManagedCommands(
      current,
      (candidate) => candidate !== undefined && candidate.includes('aug-hook.')
    )
    if (retained.length > 0) {
      hooks[event] = retained
    } else {
      delete hooks[event]
    }
  }
  return { ...source, hooks }
}

export function readAuggieManagedEvents(
  source: HooksConfig,
  isManagedCommand: (command: string | undefined) => boolean
): Set<string> {
  const present = new Set<string>()
  for (const event of AUGGIE_HOOK_EVENTS) {
    const definitions = Array.isArray(source.hooks?.[event]) ? source.hooks[event] : []
    if (
      definitions.some((definition) =>
        (definition.hooks ?? []).some((hook: HookCommandConfig) => isManagedCommand(hook.command))
      )
    ) {
      present.add(event)
    }
  }
  return present
}
