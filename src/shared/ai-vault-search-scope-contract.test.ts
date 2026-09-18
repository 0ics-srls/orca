import { describe, expect, it } from 'vitest'
import { AiVaultSearchRequestSchema, AiVaultSearchResponseSchema } from './ai-vault-search-contract'
import { isUnacknowledgedScopedSearch } from './ai-vault-search-scope-acknowledgement'
import { searchResults } from './ai-vault-search-test-fixture'

describe('scope identity on the search request', () => {
  it('accepts a workspace identity', () => {
    expect(
      AiVaultSearchRequestSchema.parse({
        query: 'needle',
        within: { kind: 'workspace', worktreeId: 'repo-1::/work/app' }
      }).within
    ).toEqual({ kind: 'workspace', worktreeId: 'repo-1::/work/app' })
  })

  it('accepts a project identity under either key spelling', () => {
    for (const projectKey of ['repo:repo-1', 'project:proj-1']) {
      expect(
        AiVaultSearchRequestSchema.parse({
          query: 'needle',
          within: { kind: 'project', projectKey }
        }).within
      ).toEqual({ kind: 'project', projectKey })
    }
  })

  it('refuses an identity sent alongside explicit scope paths', () => {
    expect(() =>
      AiVaultSearchRequestSchema.parse({
        query: 'needle',
        within: { kind: 'project', projectKey: 'repo:repo-1' },
        filters: { scopePaths: ['/work/app'] }
      })
    ).toThrow(/either a scope identity or explicit scope paths/)
  })

  it('still accepts explicit scope paths with no identity, which is what --path sends', () => {
    expect(
      AiVaultSearchRequestSchema.parse({ query: 'needle', filters: { scopePaths: ['/work/app'] } })
        .filters
    ).toEqual({ scopePaths: ['/work/app'] })
  })

  it('still accepts the old shape that carries neither', () => {
    expect(AiVaultSearchRequestSchema.parse({ query: 'needle' })).toEqual({
      query: 'needle',
      limit: 20
    })
  })

  it('refuses an unknown identity kind rather than dropping the narrowing', () => {
    expect(() =>
      AiVaultSearchRequestSchema.parse({ query: 'needle', within: { kind: 'repo', repoId: 'r' } })
    ).toThrow()
  })

  it('carries the acknowledgement and the scope-unknown answer on the response', () => {
    for (const response of [
      { ...searchResults(), resolvedWithin: true },
      { kind: 'unavailable', reason: 'scope-unknown' }
    ]) {
      expect(AiVaultSearchResponseSchema.parse(response)).toEqual(response)
    }
  })

  it('names the two new per-host outcomes', () => {
    const hosts = [
      { executionHostId: 'local', outcome: 'scope-unknown' },
      { executionHostId: 'ssh:box', outcome: 'needs-update' }
    ]
    expect(AiVaultSearchResponseSchema.parse({ ...searchResults(), hosts })).toMatchObject({
      hosts
    })
  })
})

describe('acknowledgement of a scoped search', () => {
  const within = { kind: 'workspace', worktreeId: 'repo-1::/work/app' } as const

  it('reads a missing acknowledgement on a scoped request as an old host', () => {
    expect(isUnacknowledgedScopedSearch({ within }, searchResults())).toBe(true)
  })

  it('reads a present acknowledgement as scoped', () => {
    expect(
      isUnacknowledgedScopedSearch({ within }, { ...searchResults(), resolvedWithin: true })
    ).toBe(false)
  })

  it('never reads an unscoped request as needing an update', () => {
    expect(isUnacknowledgedScopedSearch({}, searchResults())).toBe(false)
  })

  it('says nothing about an answer that carried no results', () => {
    expect(isUnacknowledgedScopedSearch({ within }, { kind: 'malformed-cursor' })).toBe(false)
  })
})
