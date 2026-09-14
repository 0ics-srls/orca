import {
  agentJournalSubmissionKey,
  boundJournalKeyComponent
} from '../../../shared/agent-session-journal-item-key'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../shared/agent-session-journal-types'
import { REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES } from '../../../shared/remote-runtime-memory-limits'
import { MAX_RETAINED_SUBMISSIONS } from '../../../shared/structured-agent-session-submission-retention'
import {
  boundInlineText,
  type JournalPayloadLimits
} from '../agent-session-journal/journal-payload-bounds'

export const AGENT_SESSION_HISTORY_MAX_PAGE_BYTES = REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES / 2

const HISTORY_PAGE_ENVELOPE_RESERVE_BYTES = 64 * 1024

export const HISTORY_PAGE_CONTENT_BUDGET_BYTES =
  AGENT_SESSION_HISTORY_MAX_PAGE_BYTES - HISTORY_PAGE_ENVELOPE_RESERVE_BYTES

/** Head kept of a dispatch `reason` on the wire. Every retained submission rides on
 *  every replacing page, so this bound is multiplied by the whole retained window: at
 *  the 16 KiB default inline head that is 4 MiB of reasons on one page, past the
 *  outbound channel cap. The divisor reads as an eighth of the budget but bounds raw
 *  bytes, while the page is priced in JSON: escaping multiplies it, and a reason of
 *  control characters serializes at six bytes a character, measured at 79% of the
 *  budget across a full window. That still fits, because the reserve prices the
 *  serialized record — the conservative divisor is what buys that headroom. A kilobyte
 *  stays far above any real provider error, and clipping is marked, never silent. The
 *  bound must also stay head-preserving: `dispatchRejectionWasTransportWriteFailure`
 *  prefix-matches this string, and a tail-preserving one would reclassify a clipped
 *  transport failure as the provider's own words and show internal text to a person. */
export const DISPATCH_REASON_PAGE_LIMITS: JournalPayloadLimits = {
  inlineHeadBytes: Math.floor(HISTORY_PAGE_CONTENT_BUDGET_BYTES / 8 / MAX_RETAINED_SUBMISSIONS)
}

// Bounding once per snapshot: `submissionBytesByItemId` prices what the page ships, and
// a stable array identity keeps both its cache and the retained window stable.
const boundedBySubmissions = new WeakMap<
  readonly AgentJournalSubmission[],
  readonly AgentJournalSubmission[]
>()

/** Page records with an oversized `reason` clipped. Rows persisted before the write-site
 *  bound still carry unbounded ones, so the page cannot trust what it reads. Every record
 *  survives — dropping one re-opens the settlement hole a replacing page exists to fill. */
export function boundedPageSubmissions(
  submissions: readonly AgentJournalSubmission[]
): readonly AgentJournalSubmission[] {
  const cached = boundedBySubmissions.get(submissions)
  if (cached) {
    return cached
  }
  const bounded = submissions.map((submission) => {
    if (submission.reason === null) {
      return submission
    }
    const { text } = boundInlineText(submission.reason, DISPATCH_REASON_PAGE_LIMITS)
    return text === submission.reason ? submission : { ...submission, reason: text }
  })
  boundedBySubmissions.set(submissions, bounded)
  return bounded
}

export function historyEntryBytes(
  item: AgentJournalRenderItem,
  submissionBytes: ReadonlyMap<string, number>
): number {
  return Buffer.byteLength(JSON.stringify(item), 'utf8') + (submissionBytes.get(item.itemId) ?? 0)
}

// Keyed on the snapshot's own submissions array, which the reducer rebuilds on
// every change, so a paged read over one snapshot serializes submissions once.
const bytesBySubmissions = new WeakMap<
  readonly AgentJournalSubmission[],
  ReadonlyMap<string, number>
>()

export function submissionBytesByItemId(
  submissions: readonly AgentJournalSubmission[]
): ReadonlyMap<string, number> {
  const cached = bytesBySubmissions.get(submissions)
  if (cached) {
    return cached
  }
  const bytes = new Map(
    boundedPageSubmissions(submissions).map((submission) => [
      agentJournalSubmissionKey(submission.clientMessageId),
      Buffer.byteLength(JSON.stringify(submission), 'utf8')
    ])
  )
  bytesBySubmissions.set(submissions, bytes)
  return bytes
}

export function oversizedHistoryItem(
  item: AgentJournalRenderItem,
  byteLength: number
): AgentJournalRenderItem {
  return {
    ...item,
    itemId: boundJournalKeyComponent(item.itemId),
    body: {
      kind: 'status',
      text: `[Orca: item truncated — ${byteLength} bytes exceeds the history page budget]`
    }
  }
}

export function boundHistoryItemsByBytes(
  items: AgentJournalRenderItem[],
  keep: 'newest' | 'oldest',
  submissionBytes: ReadonlyMap<string, number>,
  maxBytes: number
): { items: AgentJournalRenderItem[]; dropped: number } {
  const ordered = groupItemsBySequence(items, keep)
  const kept: AgentJournalRenderItem[][] = []
  let total = 0
  for (const group of ordered) {
    const bytes = group.reduce((sum, item) => sum + historyEntryBytes(item, submissionBytes), 0)
    if (kept.length === 0 && bytes > maxBytes) {
      kept.push(group.map((item) => oversizedHistoryItem(item, bytes)))
      break
    }
    if (total + bytes > maxBytes) {
      break
    }
    kept.push(group)
    total += bytes
  }
  return {
    items: (keep === 'newest' ? kept.toReversed() : kept).flat(),
    dropped: items.length - kept.reduce((count, group) => count + group.length, 0)
  }
}

/** Adjacent same-sequence runs, walked from the end (`newest`) or the start (`oldest`)
 *  so a caller that stops at its window never groups the history it will not return.
 *  Groups and their items keep the order the eager forward grouping produced. */
function* groupItemsBySequence(
  items: readonly AgentJournalRenderItem[],
  keep: 'newest' | 'oldest'
): Generator<AgentJournalRenderItem[]> {
  let cursor = keep === 'newest' ? items.length : 0
  while (keep === 'newest' ? cursor > 0 : cursor < items.length) {
    if (keep === 'newest') {
      let start = cursor - 1
      const sequence = items[start].sequence
      while (start > 0 && items[start - 1].sequence === sequence) {
        start -= 1
      }
      yield items.slice(start, cursor)
      cursor = start
    } else {
      let end = cursor + 1
      const sequence = items[cursor].sequence
      while (end < items.length && items[end].sequence === sequence) {
        end += 1
      }
      yield items.slice(cursor, end)
      cursor = end
    }
  }
}

export function newestWholeSequenceGroups(
  items: readonly AgentJournalRenderItem[],
  limit: number
): AgentJournalRenderItem[] {
  const selected: AgentJournalRenderItem[][] = []
  let count = 0
  for (const group of groupItemsBySequence(items, 'newest')) {
    if (selected.length > 0 && count + group.length > limit) {
      break
    }
    selected.push(group)
    count += group.length
  }
  return selected.toReversed().flat()
}
