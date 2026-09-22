import { beforeEach, describe, expect, it } from 'vitest'
import {
  currentWorktreeCreateSequence,
  recordLocallyCreatedWorktree,
  resetWorktreeCreateSequenceForTests,
  worktreeCreatedAfter
} from './created-worktree-sequence'

const RETAINED_CREATE_RECORDS = 256

describe('local worktree create sequence', () => {
  beforeEach(resetWorktreeCreateSequenceForTests)

  it('fences a worktree created after the sequence a scan began at, and nothing created before it', () => {
    recordLocallyCreatedWorktree('repo::/before')
    const scanBegan = currentWorktreeCreateSequence()
    recordLocallyCreatedWorktree('repo::/after')

    expect(worktreeCreatedAfter('repo::/after', scanBegan)).toBe(true)
    expect(worktreeCreatedAfter('repo::/before', scanBegan)).toBe(false)
    expect(worktreeCreatedAfter('repo::/never-recorded', scanBegan)).toBe(false)
  })

  it('evicts a record once enough later creates have landed', () => {
    recordLocallyCreatedWorktree('repo::/old')
    for (let i = 0; i <= RETAINED_CREATE_RECORDS; i += 1) {
      recordLocallyCreatedWorktree(`repo::/later-${i}`)
    }

    expect(worktreeCreatedAfter('repo::/old', 0)).toBe(false)
    expect(worktreeCreatedAfter('repo::/later-1', 0)).toBe(true)
  })

  // Why this case exists: a deleted-then-recreated path yields the same id. `Map.set` on a live key
  // keeps its old slot, so without a delete first the re-created id would sit at the front of the
  // eviction order with a fresh sequence and stop the loop before anything behind it was reaped.
  it('still evicts records behind an id that was re-created with the same id', () => {
    recordLocallyCreatedWorktree('repo::/recreated')
    recordLocallyCreatedWorktree('repo::/stale')
    for (let i = 0; i < RETAINED_CREATE_RECORDS - 1; i += 1) {
      recordLocallyCreatedWorktree(`repo::/later-${i}`)
    }
    // The re-create lands with a fresh sequence while its first record is still the oldest slot.
    recordLocallyCreatedWorktree('repo::/recreated')
    recordLocallyCreatedWorktree('repo::/final')

    expect(worktreeCreatedAfter('repo::/stale', 0)).toBe(false)
    expect(worktreeCreatedAfter('repo::/recreated', 0)).toBe(true)
    expect(worktreeCreatedAfter('repo::/final', 0)).toBe(true)
  })
})
