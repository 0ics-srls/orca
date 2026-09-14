import type { AgentJournalSubmission } from './agent-session-journal-types'

function submissionsEqual(left: AgentJournalSubmission, right: AgentJournalSubmission): boolean {
  return (
    left === right ||
    (left.clientMessageId === right.clientMessageId &&
      left.fence === right.fence &&
      left.payloadFingerprint === right.payloadFingerprint &&
      left.dispatchState === right.dispatchState &&
      left.providerItemId === right.providerItemId &&
      left.reason === right.reason &&
      left.submittedAt === right.submittedAt &&
      left.resolvedAt === right.resolvedAt &&
      left.recovered === right.recovered)
  )
}

/** Structural equality: a republished page carries a fresh object for every submission
 *  it retains, so comparing references would churn the transcript on every refresh. */
export function submissionListsEqual(
  left: readonly AgentJournalSubmission[],
  right: readonly AgentJournalSubmission[]
): boolean {
  return (
    left.length === right.length &&
    left.every((submission, index) => submissionsEqual(submission, right[index]))
  )
}
