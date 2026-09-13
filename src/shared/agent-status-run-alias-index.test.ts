import { describe, expect, it } from 'vitest'
import {
  deserializeAgentStatusProviderAliasKey,
  deserializeAgentStatusRunAliasIndex,
  parseAgentStatusScopedProviderAlias,
  serializeAgentStatusProviderAliasKey,
  serializeAgentStatusRunAliasIndex,
  type AgentStatusScopedProviderAlias,
  type AgentStatusRunAliasIndex
} from './agent-status-run-alias-index'
import type { AgentStatusExecutionScope } from './agent-status-subject'

function scope(overrides: Partial<AgentStatusExecutionScope> = {}): AgentStatusExecutionScope {
  return {
    executionHostId: 'local',
    wslDistro: null,
    workspaceId: 'workspace-1',
    workspaceKind: 'git-worktree',
    ...overrides
  }
}

function alias(
  overrides: Partial<AgentStatusScopedProviderAlias> = {}
): AgentStatusScopedProviderAlias {
  return {
    ...scope(),
    provider: 'claude',
    sessionKeyKind: 'session_id',
    providerId: 'shared-provider-id',
    ...overrides
  }
}

describe('agent status provider alias index', () => {
  it('keeps the execution-scope, provider, and session-key-kind collision matrix distinct', () => {
    const scopes = [
      scope(),
      scope({ wslDistro: 'Ubuntu' }),
      scope({ executionHostId: 'ssh:target-a' }),
      scope({ executionHostId: 'runtime:peer-a' }),
      scope({ workspaceId: 'folder-1', workspaceKind: 'folder' })
    ]
    const providers = ['claude', 'codex'] as const
    const sessionKeyKinds = ['session_id', 'conversation_id'] as const
    const aliases = scopes.flatMap((executionScope) =>
      providers.flatMap((provider) =>
        sessionKeyKinds.map((sessionKeyKind) =>
          alias({ ...executionScope, provider, sessionKeyKind })
        )
      )
    )

    expect(new Set(aliases.map(serializeAgentStatusProviderAliasKey))).toHaveLength(aliases.length)
  })

  it('round-trips one provider tuple mapped to multiple run ids as a Set', () => {
    const aliasKey = serializeAgentStatusProviderAliasKey(alias())
    const index: AgentStatusRunAliasIndex = new Map([[aliasKey, new Set(['run-a', 'run-b'])]])

    const decoded = deserializeAgentStatusRunAliasIndex(serializeAgentStatusRunAliasIndex(index))

    expect(decoded?.get(aliasKey)).toBeInstanceOf(Set)
    expect(decoded?.get(aliasKey)).toEqual(new Set(['run-a', 'run-b']))
  })

  it('serializes deterministically regardless of insertion order', () => {
    const firstKey = serializeAgentStatusProviderAliasKey(alias({ providerId: 'provider-a' }))
    const secondKey = serializeAgentStatusProviderAliasKey(alias({ providerId: 'provider-b' }))
    const first: AgentStatusRunAliasIndex = new Map([
      [secondKey, new Set(['run-b', 'run-a'])],
      [firstKey, new Set(['run-c'])]
    ])
    const second: AgentStatusRunAliasIndex = new Map([
      [firstKey, new Set(['run-c'])],
      [secondKey, new Set(['run-a', 'run-b'])]
    ])

    expect(serializeAgentStatusRunAliasIndex(first)).toBe(serializeAgentStatusRunAliasIndex(second))
  })

  it('round-trips the scoped provider tuple', () => {
    const value = alias({ executionHostId: 'ssh:target-a', sessionKeyKind: 'conversation_id' })

    expect(
      deserializeAgentStatusProviderAliasKey(serializeAgentStatusProviderAliasKey(value))
    ).toEqual(value)
  })

  it.each([
    null,
    { ...alias(), provider: 'unknown' },
    { ...alias(), sessionKeyKind: 'thread_id' },
    { ...alias(), executionHostId: 'target-a' },
    { ...alias(), providerId: 'shared-provider-id', extra: true }
  ])('rejects malformed scoped alias %#', (value) => {
    expect(parseAgentStatusScopedProviderAlias(value)).toBeNull()
  })

  it.each([
    'not-json',
    JSON.stringify([{ alias: 'not-an-alias', runIds: ['run-a'] }]),
    JSON.stringify([
      {
        alias: serializeAgentStatusProviderAliasKey(alias()),
        runIds: ['run-a', 'run-a']
      }
    ]),
    JSON.stringify([
      {
        alias: serializeAgentStatusProviderAliasKey(alias()),
        runIds: []
      }
    ]),
    JSON.stringify([
      {
        alias: serializeAgentStatusProviderAliasKey(alias()),
        runIds: ['run-a'],
        extra: true
      }
    ]),
    JSON.stringify([
      { alias: serializeAgentStatusProviderAliasKey(alias()), runIds: ['run-a'] },
      { alias: serializeAgentStatusProviderAliasKey(alias()), runIds: ['run-b'] }
    ])
  ])('rejects malformed serialized alias index %#', (value) => {
    expect(deserializeAgentStatusRunAliasIndex(value)).toBeNull()
  })

  it('refuses to serialize an empty alias set', () => {
    const index: AgentStatusRunAliasIndex = new Map([
      [serializeAgentStatusProviderAliasKey(alias()), new Set()]
    ])

    expect(() => serializeAgentStatusRunAliasIndex(index)).toThrow(
      'Invalid agent status alias index entry'
    )
  })
})
