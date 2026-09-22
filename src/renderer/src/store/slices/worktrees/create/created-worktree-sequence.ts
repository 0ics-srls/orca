// Why: a worktree listing can only vouch for the catalog as of the moment its scan began. A create
// this client completes afterwards is invisible to that scan, so an authoritative reply that lacks
// it is not evidence of deletion. Recording the order of local creates lets a reply be fenced
// against them; nothing here is persisted — a fresh scan re-derives the truth.
const RETAINED_CREATE_RECORDS = 256

let createSequence = 0
const createSequenceByWorktreeId = new Map<string, number>()

export function currentWorktreeCreateSequence(): number {
  return createSequence
}

export function recordLocallyCreatedWorktree(worktreeId: string): void {
  createSequence += 1
  // Why delete first: a re-created id keeps its old iteration slot on `set`, and the eviction loop
  // below stops at the first retained entry, so it would shield every record behind it.
  createSequenceByWorktreeId.delete(worktreeId)
  createSequenceByWorktreeId.set(worktreeId, createSequence)
  for (const [id, sequence] of createSequenceByWorktreeId) {
    if (createSequence - sequence <= RETAINED_CREATE_RECORDS) {
      break
    }
    createSequenceByWorktreeId.delete(id)
  }
}

/** True when this client completed the worktree's creation after `sequenceAtRequestStart`. */
export function worktreeCreatedAfter(worktreeId: string, sequenceAtRequestStart: number): boolean {
  return (createSequenceByWorktreeId.get(worktreeId) ?? 0) > sequenceAtRequestStart
}

export function resetWorktreeCreateSequenceForTests(): void {
  createSequence = 0
  createSequenceByWorktreeId.clear()
}
