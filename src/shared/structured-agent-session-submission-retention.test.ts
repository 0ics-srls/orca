import { describe, expect, it } from 'vitest'
import type { AgentJournalSubmission } from './agent-session-journal-types'
import {
  MAX_RETAINED_SUBMISSIONS,
  retainedSubmissionWindow
} from './structured-agent-session-submission-retention'

function submissions(count: number): AgentJournalSubmission[] {
  return Array.from({ length: count }, (_unused, index) => ({
    clientMessageId: `msg-${index}`,
    fence: 1,
    payloadFingerprint: `fingerprint-${index}`,
    dispatchState: 'accepted' as const,
    providerItemId: `provider-${index}`,
    reason: null,
    submittedAt: index,
    resolvedAt: index
  }))
}

// The constant now has consumers on both sides of the wire: the host widens a replacing
// page to it, and the renderer trims to it. They have to agree on the boundary.
describe('retainedSubmissionWindow', () => {
  it('keeps everything up to the bound', () => {
    for (const count of [0, 1, MAX_RETAINED_SUBMISSIONS - 1, MAX_RETAINED_SUBMISSIONS]) {
      expect(retainedSubmissionWindow(submissions(count))).toHaveLength(count)
    }
  })

  it('drops the oldest past the bound, keeping the newest in order', () => {
    const window = retainedSubmissionWindow(submissions(MAX_RETAINED_SUBMISSIONS + 1))
    expect(window).toHaveLength(MAX_RETAINED_SUBMISSIONS)
    expect(window[0]?.clientMessageId).toBe('msg-1')
    expect(window.at(-1)?.clientMessageId).toBe(`msg-${MAX_RETAINED_SUBMISSIONS}`)
  })
})
