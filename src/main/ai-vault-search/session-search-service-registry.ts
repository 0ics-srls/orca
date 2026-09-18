import {
  AiVaultSearchRequestSchema,
  AiVaultSearchResponseSchema,
  AiVaultSearchStatusRequestSchema,
  AiVaultSearchStatusSchema
} from '../../shared/ai-vault-search-contract'
import { unavailableSessionSearchStatus } from '../../shared/ai-vault-search-client'
import { sessionSearchScopeCatalog } from './session-search-scope-catalog'
import { resolveSessionSearchScope } from './session-search-scope-resolution'
import type {
  AiVaultSearchRequest,
  AiVaultSearchResponse,
  AiVaultSearchStatus
} from '../../shared/ai-vault-search-types'
import {
  redactForTransport,
  redactStatusForTransport,
  type SessionSearchTransport
} from '../../shared/ai-vault-search-transport'
import type { SessionSearchService } from './session-search-service'

let service: SessionSearchService | null = null

export function setSessionSearchService(next: SessionSearchService | null): void {
  service = next
}

export async function searchSessionService(
  raw: unknown,
  transport: SessionSearchTransport,
  freshnessTimeoutMs = 5_000
): Promise<AiVaultSearchResponse> {
  const parsed = AiVaultSearchRequestSchema.parse(raw)
  const current = service
  if (!current) {
    return { kind: 'unavailable', reason: 'no-service' }
  }
  // The one place every entry point funnels through, so native, WSL, SSH and
  // relay hosts all turn an identity into paths the same way, exactly once.
  const scoped = applySessionSearchScope(parsed)
  if (scoped === null) {
    return { kind: 'unavailable', reason: 'scope-unknown' }
  }
  const { request, hostScopePaths } = scoped
  const freshness =
    request.freshness === 'wait-until-current'
      ? await reconcileWithin(current, freshnessTimeoutMs)
      : false
  const result = AiVaultSearchResponseSchema.parse(await current.search(request, hostScopePaths))
  if (result.kind !== 'results') {
    return result
  }
  const { debug, ...fields } = result
  return {
    ...fields,
    hits: result.hits.map((hit) => redactForTransport(hit, transport)),
    truncated: { ...result.truncated, freshness: result.truncated.freshness || freshness },
    ...(hostScopePaths ? { resolvedWithin: true as const } : {}),
    ...(request.debug && debug ? { debug } : {})
  }
}

type ScopedSessionSearch = {
  request: AiVaultSearchRequest
  /** Absent for an unscoped request, which still searches everything. */
  hostScopePaths?: readonly string[]
}

/**
 * Turns this host's scope identity into this host's paths. Null means the host
 * does not know the workspace or project, which is an answer — never a reason to
 * fall back to searching everything.
 */
function applySessionSearchScope(parsed: AiVaultSearchRequest): ScopedSessionSearch | null {
  const { within, ...request } = parsed
  if (!within) {
    return { request }
  }
  const resolution = resolveSessionSearchScope(within, sessionSearchScopeCatalog())
  if (resolution.kind === 'unknown') {
    return null
  }
  // The paths ride beside the request, never inside `filters.scopePaths`: that
  // field is capped for the clients that write it, and a host's own answer is not.
  return { request, hostScopePaths: resolution.paths }
}

export async function sessionSearchServiceStatus(
  raw: unknown,
  transport: SessionSearchTransport
): Promise<AiVaultSearchStatus> {
  AiVaultSearchStatusRequestSchema.parse(raw)
  return redactStatusForTransport(
    AiVaultSearchStatusSchema.parse(
      service ? await service.status() : unavailableSessionSearchStatus()
    ),
    transport
  )
}

async function reconcileWithin(current: SessionSearchService, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => current.reconcile())
        .then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
