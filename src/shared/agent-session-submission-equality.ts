import type { AgentJournalSubmission } from './agent-session-journal-types'

/** Returns `fields` unchanged; its only job is the second parameter. `unlisted` is
 *  `Record<never, never>` — which `{}` satisfies — exactly while the list covers every
 *  key of `AgentJournalSubmission`. Miss one and `{}` stops type-checking, naming the
 *  field it missed. */
function everyComparedField<const T extends readonly (keyof AgentJournalSubmission)[]>(
  fields: T,
  _unlisted: Record<Exclude<keyof AgentJournalSubmission, T[number]>, never>
): T {
  return fields
}

/** Compared field by field rather than by reference, and derived from these names rather
 *  than a hand-written chain. A field missing from this list would make a page whose only
 *  correction is that field compare equal, so the reducer would keep `state` and the
 *  settlement would never land — this equality's own failure mode, re-created by an edit
 *  to an unrelated file. The guard above makes that a compile error here instead. */
const COMPARED_FIELDS = everyComparedField(
  [
    'clientMessageId',
    'fence',
    'payloadFingerprint',
    'dispatchState',
    'providerItemId',
    'reason',
    'submittedAt',
    'resolvedAt',
    'recovered'
  ],
  {}
)

export function submissionsEqual(
  left: AgentJournalSubmission,
  right: AgentJournalSubmission
): boolean {
  return left === right || COMPARED_FIELDS.every((field) => left[field] === right[field])
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
