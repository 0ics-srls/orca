import { performance } from 'node:perf_hooks'
import type {
  ControlRenewalOutcome,
  ControlRenewalRequest
} from './control-renewal-statement.js'

// One flush per second turns the fleet's control-lease write rate into a
// function of the cell count rather than the host count: a cell's ~10 due
// renewals per second become one write transaction instead of ten. Well inside
// the 105s lease runway, so a host that misses a window is never at risk.
export const CONTROL_RENEWAL_BATCH_INTERVAL_MS = 1_000
// Ceiling on the parameter arrays, so a reconnect storm cannot build a statement
// with thousands of rows behind one lock chain.
export const CONTROL_RENEWAL_BATCH_MAX_ROWS = 500
// A flush slower than this is the only latency worth a line; the metrics event
// carries the distribution.
const CONTROL_RENEWAL_SLOW_FLUSH_MS = 250

export type ControlRenewalFlush = {
  rows: number
  durationMs: number
  outcomes: Record<string, number>
}

type PendingWaiter = { resolve: () => void; reject: (error: unknown) => void }

type PendingRenewal = { request: ControlRenewalRequest; waiters: PendingWaiter[] }

function pendingKey(request: ControlRenewalRequest): string {
  const { userId, relayHostId } = request.identity
  return [userId, relayHostId, request.activityId].join('\u0000')
}

// Collects the control-lease renewals a cell owes and spends one statement on
// them. Each caller still gets the single-renewal contract: the promise resolves
// on `renewed` and rejects with the outcome as its message otherwise, so callers
// keep their per-session error routing unchanged.
export class ControlRenewalBatch {
  private pending = new Map<string, PendingRenewal>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly renew: (
      rows: readonly ControlRenewalRequest[]
    ) => Promise<ControlRenewalOutcome[]>,
    private readonly logFields: () => Record<string, unknown> = () => ({}),
    private readonly observe?: (flush: ControlRenewalFlush) => void
  ) {}

  enqueue(request: ControlRenewalRequest): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const key = pendingKey(request)
      const existing = this.pending.get(key)
      if (existing) {
        // A second attempt for the same lease inside one window supersedes the
        // first expiry; both callers still hear the outcome they waited for.
        existing.request = {
          ...request,
          expiresAt: Math.max(existing.request.expiresAt, request.expiresAt)
        }
        existing.waiters.push({ resolve, reject })
        return
      }
      this.pending.set(key, { request, waiters: [{ resolve, reject }] })
      if (this.pending.size >= CONTROL_RENEWAL_BATCH_MAX_ROWS) {
        void this.flush()
        return
      }
      this.timer ??= setTimeout(() => {
        this.timer = null
        void this.flush()
      }, CONTROL_RENEWAL_BATCH_INTERVAL_MS)
      this.timer.unref?.()
    })
  }

  // Flushes run concurrently on purpose: a statement stalled in PostgreSQL must
  // not hold back the renewals that came due while it was waiting.
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const batch = [...this.pending.values()]
    this.pending = new Map()
    if (batch.length === 0) return
    const startedAt = performance.now()
    let outcomes: ControlRenewalOutcome[]
    try {
      outcomes = await this.renew(batch.map((entry) => entry.request))
    } catch (error) {
      for (const entry of batch) for (const waiter of entry.waiters) waiter.reject(error)
      this.report(batch.length, performance.now() - startedAt, { flush_failed: batch.length })
      return
    }
    const counts: Record<string, number> = {}
    for (const [index, entry] of batch.entries()) {
      const outcome = outcomes[index] ?? 'database_error'
      counts[outcome] = (counts[outcome] ?? 0) + 1
      for (const waiter of entry.waiters) {
        if (outcome === 'renewed') waiter.resolve()
        else waiter.reject(new Error(outcome))
      }
    }
    this.report(batch.length, performance.now() - startedAt, counts)
  }

  private report(rows: number, durationMs: number, outcomes: Record<string, number>): void {
    this.observe?.({ rows, durationMs, outcomes })
    const renewed = outcomes.renewed ?? 0
    if (durationMs <= CONTROL_RENEWAL_SLOW_FLUSH_MS && renewed === rows) return
    console.warn(
      JSON.stringify({
        event: 'orca_relay_control_renewal_flush',
        ...this.logFields(),
        rows,
        durationMs: Math.round(durationMs),
        outcomes
      })
    )
  }
}
