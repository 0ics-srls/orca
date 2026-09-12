import { describe, expect, it, vi } from 'vitest'

const { searchBaseRefDetailsOutcomeMock } = vi.hoisted(() => ({
  searchBaseRefDetailsOutcomeMock: vi.fn()
}))

vi.mock('../git/repo-base-ref-search', () => ({
  searchBaseRefDetailsOutcome: searchBaseRefDetailsOutcomeMock
}))
vi.mock('../providers/ssh-git-dispatch', () => ({ getSshGitProvider: vi.fn(() => null) }))

import { RuntimeRepositoryRefQueries } from './runtime-repository-ref-queries'
import type { Repo } from '../../shared/repo-types'

function queriesFor(repo: Pick<Repo, 'id' | 'path'> & Partial<Repo>): RuntimeRepositoryRefQueries {
  return new RuntimeRepositoryRefQueries({
    resolveRepo: async () => ({
      displayName: repo.id,
      badgeColor: '',
      addedAt: 0,
      ...repo
    })
  })
}

describe('runtime repo.searchRefs', () => {
  it('carries the unverifiable reason instead of an empty ref list', async () => {
    searchBaseRefDetailsOutcomeMock.mockResolvedValue({
      status: 'unverifiable',
      reason: 'git for-each-ref failed: fatal: index.lock exists'
    })

    const result = await queriesFor({ id: 'r1', path: '/repo' }).search('r1', 'feat', 10)
    expect(result).toEqual({
      refs: [],
      truncated: false,
      unverifiableReason: 'git for-each-ref failed: fatal: index.lock exists'
    })
    // How the CLI renders this reason is pinned in src/cli/repo-refs-unverifiable-format.test.ts:
    // the main-process project cannot import src/cli/ without pulling it out of its own tsconfig.
  })

  it('leaves a genuinely empty answer unannotated', async () => {
    searchBaseRefDetailsOutcomeMock.mockResolvedValue({ status: 'ok', results: [] })

    const result = await queriesFor({ id: 'r1', path: '/repo' }).search('r1', 'feat', 10)
    expect(result).toEqual({ refs: [], refDetails: [], truncated: false })
    expect(result.unverifiableReason).toBeUndefined()
  })

  it('reports a remote repo with no reachable provider as unverifiable', async () => {
    // Per docs/reference/ssh-execution-boundary.md the execution host owns this answer; having no
    // provider means nobody was asked, which is not the same as the remote repo having no refs.
    const result = await queriesFor({ id: 'r2', path: '/repo', connectionId: 'c1' }).search(
      'r2',
      'feat',
      10
    )
    expect(result.unverifiableReason).toBe('no SSH git provider for this connection')
    expect(searchBaseRefDetailsOutcomeMock).not.toHaveBeenCalledWith('/repo', 'feat', 10)
  })

  it('keeps a folder workspace an answer, because it has no refs to search', async () => {
    // Folder workspaces are not git worktrees; "no refs" there is the truth, not a failed probe.
    const result = await queriesFor({ id: 'f1', path: '/folder', kind: 'folder' }).search(
      'f1',
      'feat',
      10
    )
    expect(result).toEqual({ refs: [], truncated: false })
    expect(result.unverifiableReason).toBeUndefined()
  })
})
