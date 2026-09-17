import type { RelayDatabase } from './database.js'

export type RelayReadinessFailure =
  | 'jwks_fetch_failed'
  | 'jwks_http_failed'
  | 'jwks_timed_out'
  | 'sql_failed'

export type RelayReadinessObservation = {
  ready: boolean
  failure?: RelayReadinessFailure
  // Present only while the answer comes from the last known good probe instead of this one.
  degraded?: true
  jwksLatencyMs: number
  sqlLatencyMs: number
  totalLatencyMs: number
}

export type RelayReadinessGraceEvent = {
  grace: 'entered' | 'recovered' | 'expired'
  failure?: RelayReadinessFailure
  lastSuccessAgeMs?: number
  graceMs: number
}

export const RELAY_READINESS_GRACE_MS = 900_000
export const RELAY_MAX_READINESS_GRACE_MS = 3_600_000

type RelayReadinessOptions = {
  fetch?: typeof fetch
  timeoutMs?: number
  cacheMs?: number
  graceMs?: number
  now?: () => number
  observe?: (observation: RelayReadinessObservation) => void
  observeGrace?: (event: RelayReadinessGraceEvent) => void
}

function graceTransition(
  degraded: boolean,
  failure: RelayReadinessFailure | undefined
): RelayReadinessGraceEvent['grace'] {
  if (degraded) return 'entered'
  return failure === undefined ? 'recovered' : 'expired'
}

function fetchFailure(error: unknown): RelayReadinessFailure {
  return error instanceof Error && error.name === 'TimeoutError'
    ? 'jwks_timed_out'
    : 'jwks_fetch_failed'
}

export function createRelayReadiness(
  database: RelayDatabase,
  jwksUrl: string,
  options: RelayReadinessOptions = {}
): () => Promise<boolean> {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 2_000
  const cacheMs = options.cacheMs ?? 10_000
  const graceMs = options.graceMs ?? RELAY_READINESS_GRACE_MS
  const now = options.now ?? Date.now
  let cachedAt = Number.NEGATIVE_INFINITY
  let cached = false
  let lastObservedReady: boolean | undefined
  let lastJwksSuccessAt: number | undefined
  let lastSqlSuccessAt: number | undefined
  let inGrace = false

  return async () => {
    if (now() - cachedAt < cacheMs) return cached
    const startedAt = now()
    let jwksCompletedAt = startedAt
    let sqlStartedAt = startedAt
    let failure: RelayReadinessFailure | undefined
    try {
      let response: Response
      try {
        response = await fetchImpl(jwksUrl, { signal: AbortSignal.timeout(timeoutMs) })
      } catch (error) {
        failure = fetchFailure(error)
        throw error
      } finally {
        jwksCompletedAt = now()
      }
      if (!response.ok) {
        failure = 'jwks_http_failed'
        throw new Error(failure)
      }
      lastJwksSuccessAt = jwksCompletedAt
      sqlStartedAt = now()
      try {
        await database.query('SELECT 1 AS ready')
      } catch (error) {
        failure = 'sql_failed'
        throw error
      }
      lastSqlSuccessAt = now()
    } catch {
      // The load balancer only needs the boolean; the safe reason is emitted below.
    }
    const completedAt = now()
    // A cell that lost Postgres or the JWKS host cannot take new hosts, but the ones it already
    // carries keep working, so riding the last known good answer beats draining the whole fleet.
    const lastSuccessAt = failure === 'sql_failed' ? lastSqlSuccessAt : lastJwksSuccessAt
    const lastSuccessAgeMs =
      lastSuccessAt === undefined ? undefined : Math.max(0, completedAt - lastSuccessAt)
    const degraded =
      failure !== undefined && lastSuccessAgeMs !== undefined && lastSuccessAgeMs < graceMs
    cached = failure === undefined || degraded
    cachedAt = completedAt
    if (failure !== undefined || cached !== lastObservedReady) {
      options.observe?.({
        ready: cached,
        ...(failure ? { failure } : {}),
        ...(degraded ? { degraded: true } : {}),
        jwksLatencyMs: Math.max(0, jwksCompletedAt - startedAt),
        sqlLatencyMs: failure?.startsWith('jwks_') ? 0 : Math.max(0, completedAt - sqlStartedAt),
        totalLatencyMs: Math.max(0, completedAt - startedAt)
      })
    }
    if (degraded !== inGrace) {
      inGrace = degraded
      options.observeGrace?.({
        grace: graceTransition(degraded, failure),
        ...(failure ? { failure } : {}),
        ...(lastSuccessAgeMs === undefined ? {} : { lastSuccessAgeMs }),
        graceMs
      })
    }
    lastObservedReady = cached
    return cached
  }
}
