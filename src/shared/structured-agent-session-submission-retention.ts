import type { AgentJournalSubmission } from './agent-session-journal-types'

/**
 * How many submissions the renderer retains past the ones its loaded items reference.
 *
 * A replacing history page must be at least this wide: the renderer only ever
 * overwrites a submission on key collision, so a settlement whose item has aged out
 * of the page's item window would otherwise never reach a pane that re-attached
 * after the one streaming frame carrying it published.
 */
export const MAX_RETAINED_SUBMISSIONS = 256

/** The newest retained window of a `submittedAt`-ascending submission list. */
export function retainedSubmissionWindow(
  submissions: readonly AgentJournalSubmission[]
): readonly AgentJournalSubmission[] {
  return submissions.slice(Math.max(0, submissions.length - MAX_RETAINED_SUBMISSIONS))
}
