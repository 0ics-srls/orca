import { describe, expect, it } from 'vitest'
import {
  nativeChatShellEnvironmentPolicy,
  parseNativeChatShellEnvironmentNames
} from './native-chat-shell-environment'

describe('parseNativeChatShellEnvironmentNames', () => {
  it('splits on commas, semicolons, and whitespace, dropping invalid names and repeats', () => {
    expect(
      parseNativeChatShellEnvironmentNames('CODEX_LB_API_KEY, https_proxy;\nFOO-BAR  1BAD _OK FOO')
    ).toEqual(['CODEX_LB_API_KEY', 'https_proxy', '_OK', 'FOO'])
  })

  it('returns nothing for an empty draft', () => {
    expect(parseNativeChatShellEnvironmentNames('  \n ,; ')).toEqual([])
  })
})

describe('nativeChatShellEnvironmentPolicy', () => {
  it('inherits the whole shell when the setting is absent', () => {
    expect(nativeChatShellEnvironmentPolicy(null)).toEqual({ inheritAll: true, names: [] })
    expect(nativeChatShellEnvironmentPolicy({})).toEqual({ inheritAll: true, names: [] })
  })

  it('carries the listed names, re-validated, when inheritance is off', () => {
    expect(
      nativeChatShellEnvironmentPolicy({
        nativeChatInheritShellEnvironment: false,
        nativeChatShellEnvironmentVariables: ['CODEX_LB_API_KEY', 'not valid', 'CODEX_LB_API_KEY']
      })
    ).toEqual({ inheritAll: false, names: ['CODEX_LB_API_KEY'] })
  })
})
