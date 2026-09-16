import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateRelayPoolCanaryObservation } from './validate-relay-pool-canary-observation.mjs'

const base = { cellId: 'production-gce-c27', pool: 14, samples: 16, durationSeconds: 900,
  failureTelemetryEntries: 1, acquireTimeouts: 0, execute55P03: 0, waitersMax: 4, waitMsMax: 80, recoveryFailures: 0 }

test('accepts a healthy bounded c27 observation', () => {
  assert.equal(validateRelayPoolCanaryObservation(base).metrics.waitersMax, 4)
})

test('accepts a healthy zero-failure window when runtime samples are present', () => {
  assert.equal(validateRelayPoolCanaryObservation({ ...base, failureTelemetryEntries: 0 }).metrics.execute55P03, 0)
})

for (const [name, change, message] of [
  ['rejects another cell', { cellId: 'production-gce-c28' }, /c27/],
  ['rejects a short window', { durationSeconds: 299 }, /300 seconds/],
  ['rejects acquire starvation', { acquireTimeouts: 21 }, /acquireTimeouts/],
  ['rejects execute contention', { execute55P03: 1 }, /execute55P03/],
  ['rejects waiter pressure', { waitersMax: 17 }, /waitersMax/],
  ['rejects wait latency', { waitMsMax: 251 }, /waitMsMax/],
  ['rejects failed recovery', { recoveryFailures: 1 }, /recoveryFailures/]
]) test(name, () => assert.throws(() => validateRelayPoolCanaryObservation({ ...base, ...change }), message))
