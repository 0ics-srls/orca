import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cloudSqlMetricValues,
  validateLiveBackendHeadroom,
  validateLiveWaitingBackendHeadroom
} from './verify-relay-pool-cloud-sql-headroom.mjs'

test('parses Cloud Monitoring timeSeries response shapes', () => {
  assert.deepEqual(cloudSqlMetricValues({
    timeSeries: [{ points: [{ value: { int64Value: '106' } }, { value: { doubleValue: 104.5 } }] }]
  }), [106, 104.5])
  assert.deepEqual(cloudSqlMetricValues({
    timeSeriesData: [{ point: [{ value: { int64Value: '8' } }] }]
  }), [8])
  assert.deepEqual(cloudSqlMetricValues({ unit: '1' }), [])
})

test('requires live backend samples and exact dispatch agreement', () => {
  assert.deepEqual(validateLiveBackendHeadroom({ values: [120, 130], expected: 130 }), { maximum: 130, samples: 2 })
  assert.throws(() => validateLiveBackendHeadroom({ values: [], expected: 0 }), /no samples/)
  assert.throws(() => validateLiveBackendHeadroom({ values: [251] }), /insufficient/)
  assert.throws(() => validateLiveBackendHeadroom({ values: [130], expected: 129 }), /does not match/)
})

test('validates the supported Cloud SQL waiting-backend metric', () => {
  assert.deepEqual(validateLiveWaitingBackendHeadroom({ values: [0, 2], expected: 2 }), { maximum: 2, samples: 2 })
  assert.throws(() => validateLiveWaitingBackendHeadroom({ values: [] }), /no samples/)
  assert.throws(() => validateLiveWaitingBackendHeadroom({ values: [21] }), /insufficient/)
  assert.throws(() => validateLiveWaitingBackendHeadroom({ values: [2], expected: 1 }), /does not match/)
})
