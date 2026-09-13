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

// Never trust a host id the far side returned; this parent owns which host it addressed.
export function withSearchExecutionHost(
  response: AiVaultSearchResponse,
  executionHostId: ExecutionHostId
): AiVaultSearchResponse {
  return response.kind === 'results'
    ? { ...response, hits: stampExecutionHost(response.hits, executionHostId) }
    : response
}

export function encodeMergedSearchCursor(byHost: Readonly<Record<string, string>>): string {
  return Buffer.from(JSON.stringify(byHost), 'utf8').toString('base64url')
}

export function decodeMergedSearchCursor(cursor: string): Record<string, string> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const entries = Object.entries(parsed)
  return entries.every(([, value]) => typeof value === 'string')
    ? (Object.fromEntries(entries) as Record<string, string>)
    : null
}

/**
 * Why: relevance scores come from independent indexes and are not comparable, so
 * the merge orders by recency only and asks every leg for that same order.
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
  const legRequest: AiVaultSearchRequest = {
    ...request,
    filters: { ...request.filters, sort: 'newest' }
  }
  delete legRequest.cursor
  const targeted = resumed
    ? legs.filter((leg) => resumed[leg.executionHostId] !== undefined)
    : [...legs]
  const settled = await Promise.all(
    targeted.map(async (leg) => {
      const hostCursor = resumed?.[leg.executionHostId]
      const hostRequest =
        hostCursor === undefined ? legRequest : { ...legRequest, cursor: hostCursor }
      try {
        return { leg, response: await withLegTimeout(leg.search(hostRequest), leg.timeoutMs) }
      } catch (error) {
        console.error(`[ai-vault-search] ${leg.executionHostId} leg failed:`, error)
        return { leg, response: null }
      }
    })
  )
  return mergeHostSearchResults(settled, {
    limit: resolveSessionSearchLimit(request.limit),
    durationMs: Date.now() - startedAt,
    // A cursor may name a host that has since disconnected; report it, don't fail the merge.
    unreachable: resumed
      ? Object.keys(resumed).filter((id) => !legs.some((leg) => leg.executionHostId === id))
      : []
  })
}

type SettledHostLeg = { leg: SessionSearchHostLeg; response: AiVaultSearchResponse | null }

function mergeHostSearchResults(
  settled: readonly SettledHostLeg[],
  merge: { limit: number; durationMs: number; unreachable: readonly string[] }
): AiVaultSearchResponse {
  const hits: AiVaultSearchHit[] = []
  const hosts: AiVaultSearchHostOutcome[] = []
  const nextCursors: Record<string, string> = {}
  const truncated = { candidates: false, snippets: 0, query: false, freshness: false }
  let generation = 0
  let hasMore = false
  for (const { leg, response } of settled) {
    const executionHostId = leg.executionHostId
    if (!response) {
      hosts.push({ executionHostId, outcome: 'unreachable' })
      continue
    }
    hosts.push({ executionHostId, outcome: response.kind })
    if (response.kind !== 'results') {
      continue
    }
    hits.push(...stampExecutionHost(response.hits, executionHostId))
    hasMore ||= response.page.hasMore
    if (response.page.hasMore && response.page.cursor !== null) {
      nextCursors[executionHostId] = response.page.cursor
    }
    truncated.candidates ||= response.truncated.candidates
    truncated.snippets += response.truncated.snippets
    truncated.query ||= response.truncated.query
    truncated.freshness ||= response.truncated.freshness
    if (executionHostId === LOCAL_EXECUTION_HOST_ID) {
      generation = response.generation
    }
  }
  for (const executionHostId of merge.unreachable) {
    hosts.push({ executionHostId, outcome: 'unreachable' })
  }
  const hasNextCursors = Object.keys(nextCursors).length > 0
  return {
    kind: 'results',
    hits: hits.sort(byRecencyDescending).slice(0, merge.limit),
    page: { cursor: hasNextCursors ? encodeMergedSearchCursor(nextCursors) : null, hasMore },
    // Per-host generations live inside the cursor; the merged fence is the local host's.
    generation,
    truncated,
    durationMs: merge.durationMs,
    hosts
  }
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
