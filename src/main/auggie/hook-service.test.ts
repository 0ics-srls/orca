import { describe, expect, it } from 'vitest'
import { buildAuggieManagedScript } from './hook-service'
import { wrapPosixHookCommand } from '../agent-hooks/installer-utils'

describe('Auggie hook launcher contract', () => {
  it('uses bounded stdin and the Auggie endpoint for fish/posix launches', () => {
    const source = buildAuggieManagedScript('posix')
    expect(source).toContain('JSONDecoder')
    expect(source).toContain('/hook/aug')
    expect(source).toContain('--data-urlencode "payload@-"')
  })

  it('quotes argv paths containing spaces and shell metacharacters', () => {
    const command = wrapPosixHookCommand("/tmp/Orca Hooks/aug's hook.sh")
    expect(command).toContain("'/tmp/Orca Hooks/aug'\\''s hook.sh'")
    expect(command).toContain('/bin/sh')
    expect(command).not.toContain('bash -c')
  })
})
