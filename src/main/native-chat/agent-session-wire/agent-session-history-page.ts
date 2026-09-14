// Paged history over one journal.
//
// `tail` and `before` read the REDUCED timeline, so backward paging keeps
// working after compaction — the folded snapshot still holds every live item.
// `after` is the catch-up direction and must read rows instead: an item created
// early and revised late orders by its creation sequence, so an item-window
// read would silently skip that revision. Rows carry the revision, which is why
// `after` is the only direction that can answer `cursor_compacted`.

import { agentJournalSubmissionKey } from '../../../shared/agent-session-journal-item-key'
import type {
  AgentJournalCursor,
  AgentJournalRenderItem,
  AgentJournalSnapshot
} from '../../../shared/agent-session-journal-types'
import {
  AGENT_SESSION_HISTORY_DEFAULT_LIMIT,
  AGENT_SESSION_HISTORY_MAX_LIMIT,
  type AgentSessionHistoryDirection,
  type AgentSessionHistoryPage,
  type AgentSessionHistoryRequest,
  type AgentSessionHistoryResult
} from '../../../shared/agent-session-wire'
import type { JournalRow } from '../agent-session-journal/journal-row-schema'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { projectJournalBatch, type JournalBatchProjection } from './agent-session-journal-batch'
import { withoutRetiredProviderExitStatusItems } from './agent-session-retired-provider-exit-status-filter'
import {
  boundHistoryItemsByBytes,
  HISTORY_PAGE_CONTENT_BUDGET_BYTES,
  historyEntryBytes,
  newestWholeSequenceGroups,
  oversizedHistoryItem,
  submissionBytesByItemId
} from './agent-session-history-page-bounds'

export { AGENT_SESSION_HISTORY_MAX_PAGE_BYTES } from './agent-session-history-page-bounds'

/** Clamped, never rejected: a client asking for more than the host will serve
 *  should get a smaller page and keep paging, not an error mid-scroll. */
export function resolveHistoryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return AGENT_SESSION_HISTORY_DEFAULT_LIMIT
  }
  return Math.min(AGENT_SESSION_HISTORY_MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

export function readAgentSessionHistory(
  journal: AgentSessionJournal,
  request: AgentSessionHistoryRequest,
  /** Reduced state to read against. A synchronous multi-page catch-up passes one
   *  snapshot for the whole run so each page costs its own rows, not the timeline. */
  snapshot: AgentJournalSnapshot = journal.snapshot()
): AgentSessionHistoryResult {
  if (journal.isReadOnly) {
    return historyReset(snapshot, 'schema_unreadable')
  }
  const limit = resolveHistoryLimit(request.limit)
  if (request.direction === 'after') {
    return readForward(journal, snapshot, request.cursor, limit)
  }
  const cursor = request.direction === 'before' ? request.cursor : undefined
  if (cursor) {
    if (cursor.epoch !== snapshot.cursor.epoch) {
      return historyReset(snapshot, 'epoch_changed')
    }
    if (cursor.sequence > snapshot.cursor.sequence) {
      return historyReset(snapshot, 'cursor_ahead')
    }
  }
  const timeline = renderableTimeline(snapshot)
  const older = cursor ? timeline.filter((item) => item.sequence < cursor.sequence) : timeline
  const windowed = newestWholeSequenceGroups(older, limit)
  const { items, dropped } = boundHistoryItemsByBytes(
    windowed,
    'newest',
    submissionBytesByItemId(snapshot.submissions),
    HISTORY_PAGE_CONTENT_BUDGET_BYTES
  )
  return {
    ok: true,
    page: buildPage({
      snapshot,
      direction: request.direction,
      items,
      hasOlder: older.length > windowed.length || dropped > 0,
      hasNewer: older.length < timeline.length,
      fallbackCursor: cursor ?? { epoch: snapshot.cursor.epoch, sequence: 0 },
      nextCursor: items[0]
        ? { epoch: snapshot.cursor.epoch, sequence: items[0].sequence }
        : undefined
    })
  }
}

/**
 * The snapshot timeline with retired rows already gone. Every backward read measures THIS array:
 * the window bound, `hasOlder`, `hasNewer`, `window.oldest` and `nextCursor` all have to agree
 * with what the page actually carries.
 *
 * Retiring on the way out instead lets a window land entirely on retired rows and return an empty
 * page that still claims older history — a cursor that never advances, which is a reader spinning
 * on one request rather than a transcript that finished loading.
 *
 * Keyed on the snapshot's own items array, which the reducer rebuilds on every change, so a
 * multi-page read over one snapshot filters once.
 */
const renderableTimelines = new WeakMap<
  readonly AgentJournalRenderItem[],
  AgentJournalRenderItem[]
>()

function renderableTimeline(snapshot: AgentJournalSnapshot): AgentJournalRenderItem[] {
  const cached = renderableTimelines.get(snapshot.items)
  if (cached) {
    return cached
  }
  const items = withoutRetiredProviderExitStatusItems(snapshot.items, snapshot.sessionId)
  renderableTimelines.set(snapshot.items, items)
  return items
}

/**
 * A catch-up run over one journal. Pages share one reduced timeline, so the run
 * costs its own rows instead of re-reducing every item per page; the cursor
 * check re-reduces if anything did advance the journal between pages.
 */
export function createAgentSessionCatchUpReader(
  journal: AgentSessionJournal
): (request: AgentSessionHistoryRequest) => AgentSessionHistoryResult {
  let snapshot = journal.snapshot()
  return (request) => {
    const live = journal.cursor()
    if (live.epoch !== snapshot.cursor.epoch || live.sequence !== snapshot.cursor.sequence) {
      snapshot = journal.snapshot()
    }
    return readAgentSessionHistory(journal, request, snapshot)
  }
}

export function readAgentSessionHydrationPage(
  journal: AgentSessionJournal,
  fence?: number
): AgentSessionHistoryPage {
  return buildHydrationPage(journal.snapshot(), fence)
}

function buildHydrationPage(
  snapshot: AgentJournalSnapshot,
  fence?: number
): AgentSessionHistoryPage {
  const timeline = renderableTimeline(snapshot)
  const items = newestWholeSequenceGroups(timeline, AGENT_SESSION_HISTORY_MAX_LIMIT)
  const bounded = boundHistoryItemsByBytes(
    items,
    'newest',
    submissionBytesByItemId(snapshot.submissions),
    HISTORY_PAGE_CONTENT_BUDGET_BYTES
  )
  return buildPage({
    snapshot,
    direction: 'tail',
    items: bounded.items,
    hasOlder: timeline.length > items.length || bounded.dropped > 0,
    hasNewer: false,
    fallbackCursor: { epoch: snapshot.cursor.epoch, sequence: 0 },
    nextCursor: bounded.items[0]
      ? { epoch: snapshot.cursor.epoch, sequence: bounded.items[0].sequence }
      : undefined,
    fence
  })
}

function historyReset(
  snapshot: AgentJournalSnapshot,
  reset: Extract<AgentSessionHistoryResult, { ok: false }>['reset']
): AgentSessionHistoryResult {
  return {
    ok: false,
    reset,
    page: buildHydrationPage(snapshot)
  }
}

/** The other source of render items in this module. Retiring here keeps the forward page's byte
 *  budget honest too — a hidden row must not spend the budget a visible one needs. The cursor is
 *  row-derived, so a forward page may legitimately be empty and still advance. */
function projectRenderableBatch(
  journal: AgentSessionJournal,
  snapshot: AgentJournalSnapshot,
  rows: readonly JournalRow[],
  afterSequence: number
): JournalBatchProjection {
  const projected = projectJournalBatch({
    rows,
    snapshot,
    afterSequence,
    canonicalItemId: (itemId) => journal.canonicalItemId(itemId)
  })
  if (!projected.ok) {
    return projected
  }
  const items = withoutRetiredProviderExitStatusItems(projected.batch.items, snapshot.sessionId)
  return items.length === projected.batch.items.length
    ? projected
    : { ok: true, batch: { ...projected.batch, items } }
}

function readForward(
  journal: AgentSessionJournal,
  snapshot: AgentJournalSnapshot,
  cursor: AgentJournalCursor | undefined,
  limit: number
): AgentSessionHistoryResult {
  if (!cursor) {
    // Why: forward paging replays rows after a position; without one there is
    // nothing to be after, and silently serving the tail would hand the client
    // a page it cannot place.
    return historyReset(snapshot, 'cursor_ahead')
  }
  // One lookahead preserves hasNewer without rereading the entire remaining journal per page.
  const since = journal.readSince(cursor, limit + 1)
  if (!since.ok) {
    return historyReset(snapshot, since.reset)
  }
  const submissionBytes = submissionBytesByItemId(snapshot.submissions)
  // The page cost is EVERYTHING variable it carries: items with their
  // submissions AND removal ids — a legal pre-bounding tombstone id can dwarf
  // every item on the page.
  const pageContentBytes = (
    items: readonly AgentJournalRenderItem[],
    removedItemIds: readonly string[]
  ): number =>
    items.reduce((total, item) => total + historyEntryBytes(item, submissionBytes), 0) +
    removedItemIds.reduce(
      (total, itemId) => total + Buffer.byteLength(JSON.stringify(itemId), 'utf8') + 1,
      0
    )
  // Rows replay forward, so the byte bound shrinks the ROW window rather than
  // clipping projected items: dropping an item while advancing the cursor past
  // the rows that touched it would lose that revision for good.
  let rows = since.rows.slice(0, limit)
  let projected = projectRenderableBatch(journal, snapshot, rows, cursor.sequence)
  if (!projected.ok) {
    return historyReset(snapshot, projected.reset)
  }
  let contentBytes = pageContentBytes(projected.batch.items, projected.batch.removedItemIds)
  while (rows.length > 1 && contentBytes > HISTORY_PAGE_CONTENT_BUDGET_BYTES) {
    rows = rows.slice(0, Math.ceil(rows.length / 2))
    const shrunk = projectRenderableBatch(journal, snapshot, rows, cursor.sequence)
    if (!shrunk.ok) {
      return historyReset(snapshot, shrunk.reset)
    }
    projected = shrunk
    contentBytes = pageContentBytes(projected.batch.items, projected.batch.removedItemIds)
  }
  // One row can still touch an over-budget item; degrade it visibly.
  let items = projected.batch.items
  if (contentBytes > HISTORY_PAGE_CONTENT_BUDGET_BYTES) {
    items = items.map((item) => {
      const bytes = historyEntryBytes(item, submissionBytes)
      return bytes > HISTORY_PAGE_CONTENT_BUDGET_BYTES ? oversizedHistoryItem(item, bytes) : item
    })
    contentBytes = pageContentBytes(items, projected.batch.removedItemIds)
  }
  if (contentBytes > HISTORY_PAGE_CONTENT_BUDGET_BYTES) {
    // A single row's semantic payload — in practice a pre-bounding oversized
    // removal id — can never fit any page, and truncating a removal id would
    // break the client's keying. A bounded tail replaces the client's state
    // wholesale, which applies the removal without carrying the id, and the
    // client resumes from the live cursor past this row.
    return historyReset(snapshot, 'cursor_compacted')
  }
  const lastSequence = rows.at(-1)?.seq ?? cursor.sequence
  return {
    ok: true,
    page: buildPage({
      snapshot,
      direction: 'after',
      items,
      removedItemIds: projected.batch.removedItemIds,
      // Reading after a position means there is something before it.
      hasOlder: cursor.sequence > 0,
      hasNewer: since.rows.length > rows.length,
      fallbackCursor: cursor,
      nextCursor: { epoch: cursor.epoch, sequence: lastSequence }
    })
  }
}

function buildPage(input: {
  snapshot: AgentJournalSnapshot
  direction: AgentSessionHistoryDirection
  items: AgentJournalRenderItem[]
  removedItemIds?: string[]
  hasOlder: boolean
  hasNewer: boolean
  fallbackCursor: AgentJournalCursor
  nextCursor: AgentJournalCursor | undefined
  fence?: number
}): AgentSessionHistoryPage {
  const epoch = input.snapshot.cursor.epoch
  // PRECONDITION: `items` is already renderable. Every path in this module reaches here through
  // `renderableTimeline` or `projectRenderableBatch`, which is what keeps the paging math and the
  // page's own contents reading the same array.
  const items = input.items
  const pageItemIds = new Set(items.map((item) => item.itemId))
  const oldest = items[0]
  const newest = items.at(-1)
  return {
    sessionId: input.snapshot.sessionId,
    epoch,
    ...(input.fence !== undefined ? { fence: input.fence } : {}),
    direction: input.direction,
    items,
    removedItemIds: input.removedItemIds ?? [],
    submissions: input.snapshot.submissions.filter((submission) =>
      pageItemIds.has(agentJournalSubmissionKey(submission.clientMessageId))
    ),
    window: {
      oldest: oldest ? { epoch, sequence: oldest.sequence } : null,
      newest: newest ? { epoch, sequence: newest.sequence } : null,
      nextCursor: input.nextCursor ?? input.fallbackCursor
    },
    liveCursor: input.snapshot.cursor,
    hasOlder: input.hasOlder,
    hasNewer: input.hasNewer
  }
}
