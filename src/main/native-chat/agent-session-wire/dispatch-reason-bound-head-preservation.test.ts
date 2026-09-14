import { describe, expect, it } from 'vitest'
import type { AgentJournalSubmission } from '../../../shared/agent-session-journal-types'
import {
  DISPATCH_REJECTED_WRITE_FAILED,
  dispatchRejectionReasonIsInternal,
  dispatchRejectionWasTransportWriteFailure,
  dispatchWriteFailureReason
} from '../../../shared/structured-agent-session-dispatch-rejection'
import {
  DEFAULT_JOURNAL_PAYLOAD_LIMITS,
  boundInlineText
} from '../agent-session-journal/journal-payload-bounds'
import {
  DISPATCH_REASON_PAGE_LIMITS,
  boundedPageSubmissions
} from './agent-session-history-page-bounds'

/** A transport failure carries an arbitrary `error.message`, so this reason — alone among
 *  the ones Orca writes — can exceed either bound. */
function transportFailureReason(detail: string): string {
  return dispatchWriteFailureReason(new Error(detail))
}

function submission(reason: string): AgentJournalSubmission {
  return {
    clientMessageId: 'orca-op-1',
    fence: 1,
    payloadFingerprint: 'f'.repeat(64),
    dispatchState: 'rejected',
    providerItemId: null,
    reason,
    submittedAt: 1,
    resolvedAt: 2
  }
}

describe('dispatch reason bounds are head-preserving', () => {
  // `dispatchRejectionWasTransportWriteFailure` prefix-matches the first 23 bytes, so a
  // bound that kept the tail or replaced the value with a digest would silently reclassify
  // a clipped transport failure as a provider's own words and render internal error text
  // to a person. Nothing else fails if that changes.
  it('keeps a clipped transport failure classifiable on the wire', () => {
    const reason = transportFailureReason('d'.repeat(4 * 1024))
    const [bounded] = boundedPageSubmissions([submission(reason)])
    const clipped = bounded?.reason ?? ''

    // Without this the assertions below would pass on a reason that was never clipped.
    expect(clipped).not.toBe(reason)
    expect(clipped.startsWith(`${DISPATCH_REJECTED_WRITE_FAILED}: `)).toBe(true)
    expect(dispatchRejectionWasTransportWriteFailure(clipped)).toBe(true)
    expect(dispatchRejectionReasonIsInternal(clipped)).toBe(true)
  })

  // The same prefix has to survive the write-site bound too, which clips at a different
  // limit and is what a row persists.
  it('keeps a clipped transport failure classifiable on the row', () => {
    const reason = transportFailureReason('d'.repeat(64 * 1024))
    const { text } = boundInlineText(reason, DEFAULT_JOURNAL_PAYLOAD_LIMITS)

    expect(text).not.toBe(reason)
    expect(dispatchRejectionWasTransportWriteFailure(text)).toBe(true)
    expect(dispatchRejectionReasonIsInternal(text)).toBe(true)
  })

  // "Crossing a bound is always marked" is the journal's own rule; a clipped reason that
  // looked whole would read as the provider's complete explanation.
  it('marks a clipped reason rather than clipping it silently', () => {
    const reason = transportFailureReason('d'.repeat(4 * 1024))
    const [bounded] = boundedPageSubmissions([submission(reason)])
    expect(reason.length).toBeGreaterThan(DISPATCH_REASON_PAGE_LIMITS.inlineHeadBytes)
    expect(bounded?.reason).toContain('[Orca: output truncated')
  })
})
