import { z } from 'zod'
import { resolveSessionSearchLimit } from '../../shared/ai-vault-search-limit'
import type {
  AiVaultSearchHit,
  AiVaultSearchHostOutcome,
  AiVaultSearchRequest,
  AiVaultSearchResponse
} from '../../shared/ai-vault-search-types'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../shared/execution-host'

export type SessionSearchHostLeg = {
  executionHostId: ExecutionHostId
  // Omitted for the in-process local leg, which has no transport to hang on.
  timeoutMs?: number
  search: (request: AiVaultSearchRequest) => Promise<AiVaultSearchResponse>
}

/**
 * `c` is the host cursor that produced the page currently being consumed, null
 * for that host's first page; `e` is how many of that page's hits the merge has
 * already emitted. Refetch with `c`, skip `e`, and no hit is ever skipped over.
 */
export type MergedSearchCursorEntry = { c: string | null; e: number }
export type MergedSearchCursorMap = Record<string, MergedSearchCursorEntry>
// Parsed with a schema so a legacy string-valued map is refused without a cast.
const mergedCursorMapSchema = z.record(
  z.string(),
  z.object({ c: z.string().nullable(), e: z.number().int().nonnegative() })
)

// One merged request reads at most this many pages from any single host.
const MAX_HOST_PAGES_PER_REQUEST = 3

// Never trust a host id the far side returned; this parent owns which host it addressed.
export function withSearchExecutionHost(
  response: AiVaultSearchResponse,
  executionHostId: ExecutionHostId
): AiVaultSearchResponse {
  return response.kind === 'results'
    ? { ...response, hits: stampExecutionHost(response.hits, executionHostId) }
    : response
}

export function encodeMergedSearchCursor(map: Readonly<MergedSearchCursorMap>): string {
  return Buffer.from(JSON.stringify(map), 'utf8').toString('base64url')
}

export function decodeMergedSearchCursor(cursor: string): MergedSearchCursorMap | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const result = mergedCursorMapSchema.safeParse(parsed)
  return result.success ? result.data : null
}

type HostWalk = {
  executionHostId: ExecutionHostId
  leg: SessionSearchHostLeg
  baseRequest: AiVaultSearchRequest
  outcome: AiVaultSearchHostOutcome['outcome']
  cursor: string | null
  emitted: number
  pending: AiVaultSearchHit[]
  nextCursor: string | null
  pages: number
  // This host still owes hits that this request could not read; keep its entry.
  carry: boolean
  generation: number
  truncated: { candidates: boolean; snippets: number; query: boolean; freshness: boolean }
}

/**
 * Why: relevance scores come from independent indexes and are not comparable, so
 * the merge orders by recency only and asks every leg for that same order. Legs
 * are walked page by page, so a hit that lost the cut on one page is emitted on
 * the next instead of being dropped.
 */
export async function searchAllExecutionHosts(
  request: AiVaultSearchRequest,
  legs: readonly SessionSearchHostLeg[]
): Promise<AiVaultSearchResponse> {
  const startedAt = Date.now()
  const resumed = request.cursor === undefined ? null : decodeMergedSearchCursor(request.cursor)
  if (request.cursor !== undefined && !resumed) {
    return { kind: 'malformed-cursor' }
  }
  const baseRequest: AiVaultSearchRequest = {
    ...request,
    filters: { ...request.filters, sort: 'newest' }
  }
  delete baseRequest.cursor
  const walks = legs
    .filter((leg) => !resumed || resumed[leg.executionHostId] !== undefined)
    .map((leg) => newHostWalk(leg, baseRequest))
  // A cursor can name a host that has since gone away; keep its place rather than lose its hits.
  const carried = Object.entries(resumed ?? {}).filter(
    ([executionHostId]) => !legs.some((leg) => leg.executionHostId === executionHostId)
  )
  await Promise.all(
    walks.map((walk) => {
      const entry = resumed?.[walk.executionHostId]
      return fetchHostPage(walk, entry?.c ?? null, entry?.e ?? 0, resumed !== null)
    })
  )
  const hits = await drainMergedPage(walks, resolveSessionSearchLimit(request.limit))
  return mergedSearchResponse(walks, carried, hits, Date.now() - startedAt)
}

function newHostWalk(leg: SessionSearchHostLeg, baseRequest: AiVaultSearchRequest): HostWalk {
  return {
    executionHostId: leg.executionHostId,
    leg,
    baseRequest,
    outcome: 'results',
    cursor: null,
    emitted: 0,
    pending: [],
    nextCursor: null,
    pages: 0,
    carry: false,
    generation: 0,
    truncated: { candidates: false, snippets: 0, query: false, freshness: false }
  }
}

async function fetchHostPage(
  walk: HostWalk,
  cursor: string | null,
  skip: number,
  resumable: boolean
): Promise<void> {
  walk.cursor = cursor
  walk.emitted = skip
  walk.pages += 1
  let response: AiVaultSearchResponse
  try {
    response = await withLegTimeout(
      walk.leg.search(cursor === null ? walk.baseRequest : { ...walk.baseRequest, cursor }),
      walk.leg.timeoutMs
    )
  } catch (error) {
    console.error(`[ai-vault-search] ${walk.executionHostId} leg failed:`, error)
    walk.outcome = 'unreachable'
    walk.pending = []
    walk.nextCursor = null
    // Only a leg that was already mid-walk owes hits; a failed first page is just reported.
    walk.carry = resumable
    return
  }
  walk.outcome = response.kind
  if (response.kind !== 'results') {
    walk.pending = []
    walk.nextCursor = null
    // A refused cursor stays refused, so there is nothing to resume.
    walk.carry = false
    return
  }
  walk.pending = stampExecutionHost(response.hits, walk.executionHostId).slice(skip)
  walk.nextCursor = response.page.hasMore ? response.page.cursor : null
  walk.generation = response.generation
  walk.carry = false
  walk.truncated.candidates ||= response.truncated.candidates
  walk.truncated.snippets += response.truncated.snippets
  walk.truncated.query ||= response.truncated.query
  walk.truncated.freshness ||= response.truncated.freshness
}

async function advanceHostWalk(walk: HostWalk): Promise<void> {
  while (walk.pending.length === 0 && walk.nextCursor !== null) {
    if (walk.pages >= MAX_HOST_PAGES_PER_REQUEST) {
      // Budget spent; the unread page's cursor is already this walk's nextCursor.
      walk.carry = true
      return
    }
    await fetchHostPage(walk, walk.nextCursor, 0, true)
  }
}

async function drainMergedPage(walks: HostWalk[], limit: number): Promise<AiVaultSearchHit[]> {
  const hits: AiVaultSearchHit[] = []
  while (hits.length < limit) {
    // Every head must be known before picking, so a lagging host is never skipped over.
    for (const walk of walks) {
      await advanceHostWalk(walk)
    }
    const next = mostRecentWalk(walks)
    if (!next) {
      return hits
    }
    hits.push(next.pending.shift()!)
    next.emitted += 1
  }
  return hits
}

function mostRecentWalk(walks: readonly HostWalk[]): HostWalk | null {
  let best: HostWalk | null = null
  for (const walk of walks) {
    const head = walk.pending[0]
    if (head && (!best || byRecencyDescending(head, best.pending[0]!) < 0)) {
      best = walk
    }
  }
  return best
}

function mergedSearchResponse(
  walks: readonly HostWalk[],
  carried: readonly [string, MergedSearchCursorEntry][],
  hits: AiVaultSearchHit[],
  durationMs: number
): AiVaultSearchResponse {
  const hosts: AiVaultSearchHostOutcome[] = walks.map((walk) => ({
    executionHostId: walk.executionHostId,
    outcome: walk.outcome
  }))
  const nextMap: MergedSearchCursorMap = {}
  const truncated = { candidates: false, snippets: 0, query: false, freshness: false }
  let generation = 0
  for (const walk of walks) {
    const entry = nextCursorEntry(walk)
    if (entry) {
      nextMap[walk.executionHostId] = entry
    }
    truncated.candidates ||= walk.truncated.candidates
    truncated.snippets += walk.truncated.snippets
    truncated.query ||= walk.truncated.query
    truncated.freshness ||= walk.truncated.freshness
    if (walk.executionHostId === LOCAL_EXECUTION_HOST_ID) {
      generation = walk.generation
    }
  }
  for (const [executionHostId, entry] of carried) {
    hosts.push({ executionHostId, outcome: 'unreachable' })
    nextMap[executionHostId] = entry
  }
  const hasMore = Object.keys(nextMap).length > 0
  return {
    kind: 'results',
    hits,
    page: { cursor: hasMore ? encodeMergedSearchCursor(nextMap) : null, hasMore },
    // Per-host generations live inside the cursor; the merged fence is the local host's.
    generation,
    truncated,
    durationMs,
    hosts
  }
}

// Resume where this request stopped: mid-page by skip count, else the unread page.
function nextCursorEntry(walk: HostWalk): MergedSearchCursorEntry | null {
  if (walk.pending.length > 0) {
    return { c: walk.cursor, e: walk.emitted }
  }
  if (walk.nextCursor !== null) {
    return { c: walk.nextCursor, e: 0 }
  }
  return walk.carry ? { c: walk.cursor, e: walk.emitted } : null
}

function stampExecutionHost(
  hits: readonly AiVaultSearchHit[],
  executionHostId: ExecutionHostId
): AiVaultSearchHit[] {
  return hits.map((hit) => ({ ...hit, executionHostId }))
}

function byRecencyDescending(left: AiVaultSearchHit, right: AiVaultSearchHit): number {
  const leftMs = updatedAtMs(left)
  const rightMs = updatedAtMs(right)
  if (leftMs === rightMs) {
    return 0
  }
  return leftMs === null ? 1 : rightMs === null ? -1 : rightMs - leftMs
}

function updatedAtMs(hit: AiVaultSearchHit): number | null {
  const parsed = hit.updatedAt === null ? Number.NaN : Date.parse(hit.updatedAt)
  return Number.isNaN(parsed) ? null : parsed
}

async function withLegTimeout<T>(pending: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) {
    return pending
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Session search host timed out.')), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
