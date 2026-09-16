import { readFileSync } from 'node:fs'

function nonNegative(value, name) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} is invalid`)
  return number
}

export function collectRelayPoolCanaryObservation(input) {
  const entries = Array.isArray(input.entries) ? input.entries : []
  const metrics = entries.map((entry) => entry.jsonPayload ?? entry).filter((entry) => entry && typeof entry === 'object')
  const scopedMetrics = metrics.filter((entry) => {
    // Console JSON diagnostics omit cellId; the logging query supplies the
    // restriction. Never accept an explicitly different cell in the payload.
    if (entry.cellId !== undefined && entry.cellId !== input.cellId) {
      throw new Error(`observation contains ${entry.cellId}, expected ${input.cellId}`)
    }
    return true
  })
  const queryFailures = scopedMetrics.filter((entry) => entry.event === 'orca_relay_postgres_query_failed')
  const transactionFailures = scopedMetrics.filter((entry) =>
    entry.event === 'orca_relay_postgres_transaction_retry' ||
    entry.event === 'orca_relay_postgres_transaction_exhausted')
  const failures = [...queryFailures, ...transactionFailures]
  const runtime = scopedMetrics.filter((entry) => entry.event === 'orca_relay_runtime_metrics')
  const samples = runtime.length
  const durationSeconds = Math.max(0, Math.round((Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000))
  if (!Number.isFinite(durationSeconds)) throw new Error('observation timestamps are invalid')
  return {
    cellId: input.cellId,
    pool: Number(input.pool),
    samples,
    durationSeconds,
    failureTelemetryEntries: failures.length,
    acquireTimeouts: failures.filter((entry) => entry.phase === 'acquire' && entry.connectionTimeout === true).length,
    execute55P03: queryFailures.filter((entry) => entry.phase === 'execute' && entry.code === '55P03').length +
      transactionFailures.filter((entry) => entry.code === '55P03').length,
    waitersMax: Math.max(0, ...runtime.map((entry) => nonNegative(entry.databasePoolWaitersMax, 'pool waiters'))),
    waitMsMax: Math.max(0, ...runtime.map((entry) => nonNegative(entry.databasePoolWaitMsMax, 'pool wait ms'))),
    recoveryFailures: Math.max(0, ...runtime.map((entry) => nonNegative(
      entry.controlActivityRecoveryFailuresDelta ?? entry.controlActivityRecoveryFailures,
      'recovery failures')))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  process.stdout.write(`${JSON.stringify(collectRelayPoolCanaryObservation(input))}\n`)
}
