import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectRelayPoolCanaryObservation } from './collect-relay-pool-canary-observation.mjs'

test('aggregates c27 query phases and runtime pressure', () => {
  const result = collectRelayPoolCanaryObservation({ cellId: 'production-gce-c27', pool: 14,
    startedAt: '2026-09-15T01:00:00Z', endedAt: '2026-09-15T01:05:00Z', entries: [
      { jsonPayload: { event: 'orca_relay_runtime_metrics', databasePoolWaitersMax: 4, databasePoolWaitMsMax: 80, controlActivityRecoveryFailuresDelta: 0 } },
      { jsonPayload: { event: 'orca_relay_postgres_query_failed', phase: 'acquire', connectionTimeout: true } },
      { jsonPayload: { event: 'orca_relay_postgres_query_failed', phase: 'execute', code: '55P03' } },
      { jsonPayload: { event: 'orca_relay_postgres_transaction_retry', code: '55P03', phase: 'cell-inventory' } }
    ] })
  assert.deepEqual(result, { cellId: 'production-gce-c27', pool: 14, samples: 1, durationSeconds: 300, failureTelemetryEntries: 3,
    acquireTimeouts: 1, execute55P03: 2, waitersMax: 4, waitMsMax: 80, recoveryFailures: 0 })
})

test('rejects an explicitly mixed-cell payload even when the log query was scoped', () => {
  assert.throws(() => collectRelayPoolCanaryObservation({
    cellId: 'production-gce-c27', pool: 14,
    startedAt: '2026-09-15T01:00:00Z', endedAt: '2026-09-15T01:05:00Z',
    entries: [{ jsonPayload: { event: 'orca_relay_runtime_metrics', cellId: 'production-gce-c28' } }]
  }), /expected production-gce-c27/)
})

test('fails closed when runtime recovery telemetry is absent', () => {
  assert.throws(() => collectRelayPoolCanaryObservation({
    cellId: 'production-gce-c27', pool: 14,
    startedAt: '2026-09-15T01:00:00Z', endedAt: '2026-09-15T01:05:00Z',
    entries: [{ jsonPayload: {
      event: 'orca_relay_runtime_metrics', databasePoolWaitersMax: 0, databasePoolWaitMsMax: 0
    } }]
  }), /recovery failures is invalid/)
})
