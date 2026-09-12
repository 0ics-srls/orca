// An unverifiable ref search must not print as "No refs found.": that sentence asserts the repo has
// no matching ref, which is precisely what a failed probe did not establish.
import { describe, expect, it } from 'vitest'
import type { RuntimeRepoSearchRefs } from '../shared/runtime-types'
import { formatRepoRefs } from './workspace-format'

describe('formatRepoRefs', () => {
  it('names the reason the host could not answer', () => {
    const result: RuntimeRepoSearchRefs = {
      refs: [],
      truncated: false,
      unverifiableReason: 'git for-each-ref failed: fatal: index.lock exists'
    }
    expect(formatRepoRefs(result)).toBe(
      'refs: unverifiable — git for-each-ref failed: fatal: index.lock exists'
    )
  })

  it('still reports a genuinely empty answer as one', () => {
    // Folder workspaces land here too: they are not git worktrees, so "no refs" is the truth.
    expect(formatRepoRefs({ refs: [], truncated: false })).toBe('No refs found.')
  })

  it('prefers the reason over a partial list, which would read as the whole answer', () => {
    expect(
      formatRepoRefs({
        refs: ['refs/heads/main'],
        truncated: false,
        unverifiableReason: 'no SSH git provider for this connection'
      })
    ).toBe('refs: unverifiable — no SSH git provider for this connection')
  })
})
