import { describe, expect, it, vi } from 'vitest'
import type { RelayDatabase } from './database.js'
import {
  createRelayReadiness,
  type RelayReadinessGraceEvent,
  type RelayReadinessObservation
} from './relay-readiness.js'

function database(query: () => Promise<Record<string, unknown>[]>): RelayDatabase {
  return {
    query,
    queryLocked: query,
    transaction: async (operation) => await operation(database(query)),
    close: async () => {}
  }
}

describe('relay readiness', () => {
  it('fails readiness while liveness remains independent of SQL and JWKS', async () => {
    const jwksFailure = createRelayReadiness(database(async () => [{ ready: 1 }]), 'https://jwks', {
      fetch: vi.fn(async () => new Response('', { status: 503 })) as typeof fetch,
      cacheMs: 0
    })
    const sqlFailure = createRelayReadiness(
      database(async () => {
        throw new Error('sql down')
      }),
      'https://jwks',
      {
        fetch: vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch,
        cacheMs: 0
      }
    )

    expect(await jwksFailure()).toBe(false)
    expect(await sqlFailure()).toBe(false)
  })

  it.each([
    {
      name: 'JWKS HTTP failure',
      fetch: vi.fn(async () => new Response('', { status: 503 })) as typeof fetch,
      query: vi.fn(async () => [{ ready: 1 }]),
      failure: 'jwks_http_failed'
    },
    {
      name: 'JWKS timeout',
      fetch: vi.fn(async () => {
        throw new DOMException('redacted', 'TimeoutError')
      }) as typeof fetch,
      query: vi.fn(async () => [{ ready: 1 }]),
      failure: 'jwks_timed_out'
    },
    {
      name: 'JWKS fetch failure',
      fetch: vi.fn(async () => {
        throw new Error('redacted')
      }) as typeof fetch,
      query: vi.fn(async () => [{ ready: 1 }]),
      failure: 'jwks_fetch_failed'
    },
    {
      name: 'SQL failure',
      fetch: vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch,
      query: vi.fn(async () => {
        throw new Error('redacted')
      }),
      failure: 'sql_failed'
    }
  ])('reports a safe reason for $name', async ({ fetch, query, failure }) => {
    const observations: RelayReadinessObservation[] = []
    const ready = createRelayReadiness(database(query), 'https://jwks', {
      fetch,
      cacheMs: 0,
      observe: (observation) => observations.push(observation)
    })

    expect(await ready()).toBe(false)
    expect(observations).toEqual([
      expect.objectContaining({ ready: false, failure })
    ])
    expect(JSON.stringify(observations)).not.toContain('redacted')
    if (failure.startsWith('jwks_')) expect(query).not.toHaveBeenCalled()
  })

  it('reports the initial success but not healthy repeats or cached reads', async () => {
    const observations: RelayReadinessObservation[] = []
    let now = 100
    const ready = createRelayReadiness(database(async () => [{ ready: 1 }]), 'https://jwks', {
      fetch: vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch,
      cacheMs: 10_000,
      now: () => now,
      observe: (observation) => observations.push(observation)
    })

    expect(await ready()).toBe(true)
    now += 1_000
    expect(await ready()).toBe(true)
    now += 10_000
    expect(await ready()).toBe(true)
    expect(observations).toEqual([
      {
        ready: true,
        jwksLatencyMs: 0,
        sqlLatencyMs: 0,
        totalLatencyMs: 0
      }
    ])
  })
})

describe('relay readiness last-known-good grace', () => {
  function graceProbe(input: {
    graceMs?: number
    jwksOk: () => boolean
    sqlOk: () => boolean
    now: () => number
  }) {
    const observations: RelayReadinessObservation[] = []
    const graceEvents: RelayReadinessGraceEvent[] = []
    const ready = createRelayReadiness(
      database(async () => {
        if (!input.sqlOk()) throw new Error('redacted')
        return [{ ready: 1 }]
      }),
      'https://jwks',
      {
        fetch: vi.fn(
          async () => new Response('{}', { status: input.jwksOk() ? 200 : 503 })
        ) as typeof fetch,
        cacheMs: 0,
        graceMs: input.graceMs ?? 900_000,
        now: input.now,
        observe: (observation) => observations.push(observation),
        observeGrace: (event) => graceEvents.push(event)
      }
    )
    return { ready, observations, graceEvents }
  }

  it('stays ready while a JWKS failure sits inside the grace window', async () => {
    let now = 1_000
    let jwksOk = true
    const { ready, observations } = graceProbe({
      jwksOk: () => jwksOk,
      sqlOk: () => true,
      now: () => now
    })

    expect(await ready()).toBe(true)
    jwksOk = false
    now += 899_999
    expect(await ready()).toBe(true)
    expect(observations.at(-1)).toEqual(
      expect.objectContaining({ ready: true, degraded: true, failure: 'jwks_http_failed' })
    )
  })

  it('drops readiness once the JWKS grace window expires', async () => {
    let now = 1_000
    let jwksOk = true
    const { ready, observations } = graceProbe({
      jwksOk: () => jwksOk,
      sqlOk: () => true,
      now: () => now
    })

    expect(await ready()).toBe(true)
    jwksOk = false
    now += 900_000
    expect(await ready()).toBe(false)
    expect(observations.at(-1)).toEqual(
      expect.objectContaining({ ready: false, failure: 'jwks_http_failed' })
    )
    expect(observations.at(-1)).not.toHaveProperty('degraded')
  })

  it('applies the same grace to a SQL failure', async () => {
    let now = 1_000
    let sqlOk = true
    const { ready, observations } = graceProbe({
      jwksOk: () => true,
      sqlOk: () => sqlOk,
      now: () => now
    })

    expect(await ready()).toBe(true)
    sqlOk = false
    now += 899_999
    expect(await ready()).toBe(true)
    expect(observations.at(-1)).toEqual(
      expect.objectContaining({ ready: true, degraded: true, failure: 'sql_failed' })
    )
    now += 1
    expect(await ready()).toBe(false)
  })

  it('keeps a process that never succeeded out of the grace window', async () => {
    let now = 1_000
    const { ready, observations, graceEvents } = graceProbe({
      jwksOk: () => false,
      sqlOk: () => true,
      now: () => now
    })

    expect(await ready()).toBe(false)
    now += 1_000
    expect(await ready()).toBe(false)
    expect(graceEvents).toEqual([])
    expect(observations.every((observation) => observation.degraded === undefined)).toBe(true)
  })

  it('measures the grace window on the injected clock, not wall time', async () => {
    const now = 1_000
    let jwksOk = true
    const { ready } = graceProbe({ jwksOk: () => jwksOk, sqlOk: () => true, now: () => now })

    expect(await ready()).toBe(true)
    jwksOk = false
    for (let attempt = 0; attempt < 5; attempt++) expect(await ready()).toBe(true)
  })

  it('logs once on entering grace and once on leaving it', async () => {
    let now = 1_000
    let jwksOk = true
    const { ready, graceEvents } = graceProbe({
      jwksOk: () => jwksOk,
      sqlOk: () => true,
      now: () => now
    })

    expect(await ready()).toBe(true)
    jwksOk = false
    now += 1_000
    expect(await ready()).toBe(true)
    now += 1_000
    expect(await ready()).toBe(true)
    jwksOk = true
    now += 1_000
    expect(await ready()).toBe(true)
    expect(graceEvents).toEqual([
      {
        grace: 'entered',
        failure: 'jwks_http_failed',
        lastSuccessAgeMs: 1_000,
        graceMs: 900_000
      },
      { grace: 'recovered', lastSuccessAgeMs: 0, graceMs: 900_000 }
    ])
  })

  it('reports an expired window once when the dependency never comes back', async () => {
    let now = 1_000
    let jwksOk = true
    const { ready, graceEvents } = graceProbe({
      graceMs: 10_000,
      jwksOk: () => jwksOk,
      sqlOk: () => true,
      now: () => now
    })

    expect(await ready()).toBe(true)
    jwksOk = false
    now += 1_000
    expect(await ready()).toBe(true)
    now += 20_000
    expect(await ready()).toBe(false)
    expect(await ready()).toBe(false)
    expect(graceEvents.map((event) => event.grace)).toEqual(['entered', 'expired'])
  })

  it('restarts the grace window from the most recent success', async () => {
    let now = 1_000
    let jwksOk = true
    const { ready } = graceProbe({
      graceMs: 10_000,
      jwksOk: () => jwksOk,
      sqlOk: () => true,
      now: () => now
    })

    expect(await ready()).toBe(true)
    jwksOk = false
    now += 9_000
    expect(await ready()).toBe(true)
    jwksOk = true
    now += 1_000
    expect(await ready()).toBe(true)
    jwksOk = false
    now += 9_000
    expect(await ready()).toBe(true)
  })

  it('never serves grace when the window is disabled', async () => {
    let now = 1_000
    let jwksOk = true
    const { ready, graceEvents } = graceProbe({
      graceMs: 0,
      jwksOk: () => jwksOk,
      sqlOk: () => true,
      now: () => now
    })

    expect(await ready()).toBe(true)
    jwksOk = false
    expect(await ready()).toBe(false)
    expect(graceEvents).toEqual([])
  })
})
