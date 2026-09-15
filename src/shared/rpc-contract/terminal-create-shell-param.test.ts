import { describe, expect, it } from 'vitest'
import { TerminalCreateParams } from './terminal-unary-params'

describe('TerminalCreateParams.shell', () => {
  it('stays optional so older callers keep creating terminals', () => {
    const parsed = TerminalCreateParams.parse({ worktree: 'path:/repo' })

    expect(parsed.shell).toBeUndefined()
  })

  it('carries an allowed Windows shell through to the runtime', () => {
    expect(TerminalCreateParams.parse({ worktree: 'path:/repo', shell: 'cmd.exe' }).shell).toBe(
      'cmd.exe'
    )
    expect(TerminalCreateParams.parse({ worktree: 'path:/repo', shell: 'git-bash' }).shell).toBe(
      'git-bash'
    )
  })

  // The relay refuses these at spawn time; refusing here turns an opaque spawn failure into an
  // answer the caller gets before the terminal exists.
  it('refuses a shell the host will not spawn', () => {
    expect(() => TerminalCreateParams.parse({ worktree: 'path:/repo', shell: 'nu.exe' })).toThrow(
      /shell must be one of/
    )
    expect(() =>
      TerminalCreateParams.parse({ worktree: 'path:/repo', shell: 'cmd.exe && calc' })
    ).toThrow(/shell must be one of/)
  })
})
