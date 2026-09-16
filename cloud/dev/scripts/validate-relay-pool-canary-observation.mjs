import { readFileSync } from 'node:fs'

const LIMITS = Object.freeze({
  acquireTimeouts: 20,
  execute55P03: 0,
  waitersMax: 16,
  waitMsMax: 250,
  recoveryFailures: 0
})

function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} is invalid`)
  return value
}

export function validateRelayPoolCanaryObservation(input) {
  if (input.cellId !== 'production-gce-c27') throw new Error('observation must be for c27')
  if (input.pool !== 14 && input.pool !== 10) throw new Error('observation pool is invalid')
  if (!Number.isSafeInteger(input.samples) || input.samples < 3) throw new Error('observation needs at least 3 samples')
  if (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds < 300) {
    throw new Error('observation window must be at least 300 seconds')
  }
  if (!Number.isSafeInteger(input.failureTelemetryEntries) || input.failureTelemetryEntries < 0) {
    throw new Error('observation failure telemetry count is invalid')
  }
  const metrics = {
    acquireTimeouts: count(input.acquireTimeouts, 'acquire timeouts'),
    execute55P03: count(input.execute55P03, 'execute 55P03 failures'),
    waitersMax: count(input.waitersMax, 'pool waiters'),
    waitMsMax: count(input.waitMsMax, 'pool wait ms'),
    recoveryFailures: count(input.recoveryFailures, 'recovery failures')
  }
  for (const [key, limit] of Object.entries(LIMITS)) {
    if (metrics[key] > limit) throw new Error(`${key} exceeded post-canary threshold (${limit})`)
  }
  return { cellId: input.cellId, pool: input.pool, samples: input.samples, durationSeconds: input.durationSeconds, metrics }
}

export function main(argv = process.argv.slice(2)) {
  const file = argv[0]
  const input = JSON.parse(file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8'))
  process.stdout.write(`${JSON.stringify({ event: 'relay_pool_canary_observation_verified', ...validateRelayPoolCanaryObservation(input) })}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
