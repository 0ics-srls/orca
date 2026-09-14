import { describe, expect, it } from 'vitest'
import type { AgentJournalSubmission } from './agent-session-journal-types'
import { submissionListsEqual, submissionsEqual } from './agent-session-submission-equality'

/** Keys of `AgentJournalSubmission` with the optional ones required, so a new field
 *  cannot be added without giving it a value in both fixtures below. */
type EverySubmissionField = {
  [K in keyof Required<AgentJournalSubmission>]: AgentJournalSubmission[K]
}

const BASE: EverySubmissionField = {
  clientMessageId: 'orca-op-1',
  fence: 1,
  payloadFingerprint: 'fingerprint-1',
  dispatchState: 'pending',
  providerItemId: null,
  reason: null,
  submittedAt: 100,
  resolvedAt: null,
  recovered: true
}

/** Differs from `BASE` in every field: a page that corrects only one of them must still
 *  compare unequal, whichever one it is. */
const CORRECTED: EverySubmissionField = {
  clientMessageId: 'orca-op-2',
  fence: 2,
  payloadFingerprint: 'fingerprint-2',
  dispatchState: 'accepted',
  providerItemId: 'item-7',
  reason: 'provider refused',
  submittedAt: 101,
  resolvedAt: 102,
  recovered: undefined
}

const correctedFields = Object.entries(CORRECTED)
const baseFields = new Map(Object.entries(BASE))

describe('submissionsEqual', () => {
  it('holds every field of the type distinguishable, so a flip cannot be a coincidence', () => {
    expect(correctedFields.length).toBe(baseFields.size)
    for (const [field, corrected] of correctedFields) {
      expect(baseFields.has(field)).toBe(true)
      expect({ field, value: corrected }).not.toEqual({ field, value: baseFields.get(field) })
    }
  })

  it('reports a difference in any single field', () => {
    for (const [field, corrected] of correctedFields) {
      expect(submissionsEqual(BASE, { ...BASE, [field]: corrected })).toBe(false)
    }
  })

  it('compares structurally, not by reference', () => {
    expect(submissionsEqual(BASE, { ...BASE })).toBe(true)
    expect(submissionsEqual(BASE, BASE)).toBe(true)
  })
})

describe('submissionListsEqual', () => {
  it('reports a difference in any single field of any entry', () => {
    for (const [field, corrected] of correctedFields) {
      const corrections = [BASE, { ...BASE, [field]: corrected }]
      expect(submissionListsEqual([BASE, BASE], corrections)).toBe(false)
    }
  })

  it('separates length from content', () => {
    expect(submissionListsEqual([BASE], [BASE, BASE])).toBe(false)
    expect(submissionListsEqual([BASE, BASE], [{ ...BASE }, { ...BASE }])).toBe(true)
  })
})
