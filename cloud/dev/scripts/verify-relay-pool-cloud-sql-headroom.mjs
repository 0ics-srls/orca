import { readCloudSqlBackends, readCloudSqlWaitingBackends } from './relay-asia-cloud-sql-metrics.mjs'

export function validateLiveBackendHeadroom(input) {
  const values = input.values.filter((value) => Number.isFinite(value) && value >= 0)
  if (values.length === 0) throw new Error('Cloud SQL backend metric has no samples')
  const maximum = Math.max(...values)
  if (maximum > 250) throw new Error('Cloud SQL backend headroom is insufficient')
  if (input.expected !== undefined && maximum !== Number(input.expected)) {
    throw new Error(`Cloud SQL backend input ${input.expected} does not match live maximum ${maximum}`)
  }
  return { maximum, samples: values.length }
}

export function validateLiveWaitingBackendHeadroom(input) {
  const values = input.values.filter((value) => Number.isFinite(value) && value >= 0)
  if (values.length === 0) throw new Error('Cloud SQL waiting-backend metric has no samples')
  const maximum = Math.max(...values)
  if (maximum > 20) throw new Error('Cloud SQL waiting-backend headroom is insufficient')
  if (input.expected !== undefined && maximum !== Number(input.expected)) {
    throw new Error(`Cloud SQL waiting-backend input ${input.expected} does not match live maximum ${maximum}`)
  }
  return { maximum, samples: values.length }
}

export function cloudSqlMetricValues(response) {
  return (response?.timeSeriesData ?? response?.timeSeries ?? []).flatMap((series) =>
    (series.point ?? series.points ?? []).map((point) =>
      Number(point.value?.doubleValue ?? point.value?.int64Value)
    )
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [startedAt, endedAt, expectedBackends, expectedWaitingBackends] = process.argv.slice(2)
  if (!startedAt || !endedAt || expectedBackends === undefined || expectedBackends === '' ||
      expectedWaitingBackends === undefined || expectedWaitingBackends === '') {
    throw new Error('Cloud SQL headroom requires explicit backend and waiting-backend expectations')
  }
  const backend = await readCloudSqlBackends('production', startedAt, endedAt)
  const waiting = await readCloudSqlWaitingBackends('production', startedAt, endedAt)
  process.stdout.write(`${JSON.stringify({
    backends: validateLiveBackendHeadroom({ values: cloudSqlMetricValues(backend), expected: expectedBackends }),
    waitingBackends: validateLiveWaitingBackendHeadroom({
      values: cloudSqlMetricValues(waiting), expected: expectedWaitingBackends
    })
  })}\n`)
}
