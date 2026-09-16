import { describe, expect, it } from 'vitest'
import {
  applyAuggieManagedHooks,
  AUGGIE_HOOK_EVENTS,
  readAuggieManagedEvents,
  removeAuggieManagedHooks
} from './hook-config'

describe('Auggie hook contract', () => {
  it('installs every documented event while preserving user hooks', () => {
    const source = {
      hooks: { PromptSubmit: [{ hooks: [{ type: 'command' as const, command: 'user-command' }] }] }
    }
    const next = applyAuggieManagedHooks(source, '/home/me/.orca/agent-hooks/aug-hook.sh')
    expect(Object.keys(next.hooks ?? {}).sort()).toEqual([...AUGGIE_HOOK_EVENTS].sort())
    expect(next.hooks?.PromptSubmit?.[0]?.hooks?.[0]?.command).toBe('user-command')
    expect(
      readAuggieManagedEvents(next, (command) => command?.includes('aug-hook.sh') ?? false).size
    ).toBe(6)
  })

  it('removes only Orca-owned entries', () => {
    const source = applyAuggieManagedHooks({}, '/home/me/.orca/agent-hooks/aug-hook.sh')
    const next = removeAuggieManagedHooks(source)
    expect(next.hooks).toEqual({})
  })
})
