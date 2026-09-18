// A new client against an old host, for the one skew a scope identity introduces.
//
// The old side is modelled rather than checked out because its behaviour here is
// fully determined and needs no build: `AiVaultSearchRequestSchema` strips
// unknown fields, so a host that predates `within` accepts the request, never
// sees the field, and answers with every session it has. That answer is
// well-formed `results` — nothing in the hits marks it unscoped. The only
// evidence is the missing acknowledgement, which is exactly what this pins.

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AiVaultSearchRequestSchema } from '../../../src/shared/ai-vault-search-contract'
import { isUnacknowledgedScopedSearch } from '../../../src/shared/ai-vault-search-scope-acknowledgement'
import type {
  AiVaultSearchRequest,
  AiVaultSearchResponse
} from '../../../src/shared/ai-vault-search-types'
import { searchHit } from '../../../src/shared/ai-vault-search-test-fixture'
import { searchAllExecutionHosts } from '../../../src/main/ipc/ai-vault-search-all-hosts'

const WITHIN = { kind: 'workspace', worktreeId: 'repo-1::/work/app' } as const

/** The shipped request shape, before `within` existed. Zod drops what it does not name. */
const OldHostRequestSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
  cursor: z.string().optional(),
  filters: z.object({ scopePaths: z.array(z.string()).optional() }).optional()
})

/** A host of that vintage: it narrows by `scopePaths` only, and never acknowledges a scope. */
function oldHostSearch(request: AiVaultSearchRequest): AiVaultSearchResponse {
  const received = OldHostRequestSchema.parse(request)
  const everything = [
    { ...searchHit(), sessionId: 'in-scope', cwd: '/work/app' },
    { ...searchHit(), sessionId: 'another-project', cwd: '/elsewhere' }
  ]
  const scopePaths = received.filters?.scopePaths ?? []
  return {
    kind: 'results',
    hits:
      scopePaths.length === 0
        ? everything
        : everything.filter((hit) => scopePaths.some((path) => hit.cwd?.startsWith(path))),
    page: { cursor: null, hasMore: false },
    generation: 1,
    truncated: { candidates: false, snippets: 0, query: false, freshness: false },
    durationMs: 1
  }
}

describe('a client that scopes by identity against a host that cannot', () => {
  it('reaches the old host with a parseable request that silently loses the scope', () => {
    const request = AiVaultSearchRequestSchema.parse({ query: 'needle', within: WITHIN })
    expect(request.within).toEqual(WITHIN)
    expect(OldHostRequestSchema.parse(request)).not.toHaveProperty('within')
    // The proof that this skew is not self-announcing: two projects come back.
    const answer = oldHostSearch(request)
    expect(answer.kind === 'results' && answer.hits).toHaveLength(2)
  })

  it('reads the missing acknowledgement as needing an update, not as a scope that matched everything', () => {
    const request = AiVaultSearchRequestSchema.parse({ query: 'needle', within: WITHIN })
    expect(isUnacknowledgedScopedSearch(request, oldHostSearch(request))).toBe(true)
  })

  it('leaves an old host answering an unscoped search alone', () => {
    const request = AiVaultSearchRequestSchema.parse({ query: 'needle' })
    expect(isUnacknowledgedScopedSearch(request, oldHostSearch(request))).toBe(false)
  })

  it('merges no result from the old host and names it, while a current host still answers', async () => {
    const response = await searchAllExecutionHosts({ query: 'needle', within: WITHIN }, [
      {
        executionHostId: 'runtime:old',
        search: async (request) => oldHostSearch(request)
      },
      {
        executionHostId: 'local',
        search: async (request) => ({
          // A current host resolved the identity itself and says so.
          ...oldHostSearch({ ...request, filters: { scopePaths: ['/work/app'] } }),
          resolvedWithin: { kind: 'workspace', paths: 1 }
        })
      }
    ])
    if (response.kind !== 'results') {
      throw new Error('Expected merged results')
    }
    expect(response.hits.map((hit) => hit.sessionId)).toEqual(['in-scope'])
    expect(response.hosts).toEqual([
      { executionHostId: 'local', outcome: 'searched' },
      { executionHostId: 'runtime:old', outcome: 'needs-update' }
    ])
  })
})
