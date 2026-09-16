const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')

assert.equal(process.env.ORCA_BACKGROUND_LAUNCH, '1')
const root = path.resolve(__dirname, '../../..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-watchdog-semantics-'))
const modulePath = path.join(scratch, 'watchdog.cjs')
const sources = [
  'src/main/hang-watchdog/hang-watchdog-detection-loop.ts',
  'src/main/hang-watchdog/hang-watchdog-worker-protocol.ts',
  'src/main/hang-watchdog/main-thread-hang-watchdog-entry.ts',
  'src/main/hang-watchdog/hang-detection-marker.ts'
]
try {
  const bundle = esbuild.buildSync({
    absWorkingDir: root,
    stdin: {
      contents: sources.map((source) => `export * from './${source}';`).join('\n'),
      resolveDir: root
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false
  }).outputFiles[0].contents
  fs.writeFileSync(modulePath, bundle)
  const {
    createHangWatchdogDetectionLoop,
    HANG_WATCHDOG_TIMEOUT_MS: timeoutMs,
    HANG_WATCHDOG_CHECK_INTERVAL_MS: checkIntervalMs,
    recordHangObservation,
    consumeHangDetectionMarker
  } = require(modulePath)
  const events = []
  let now = 0
  const loop = createHangWatchdogDetectionLoop({
    timeoutMs,
    checkIntervalMs,
    now: () => now,
    onHangDetected: (unresponsiveMs) => events.push({ kind: 'detected', unresponsiveMs }),
    onHangResolved: (unresponsiveMs) => events.push({ kind: 'resolved', unresponsiveMs })
  })
  const observations = []
  for (let tick = 1; tick <= 20; tick++) {
    now = tick * checkIntervalMs
    loop.tick()
    if ([5, 9, 10, 20].includes(tick)) {
      observations.push({ atMs: now, detections: events.length })
    }
  }
  assert.deepEqual(observations, [
    { atMs: 25_000, detections: 0 },
    { atMs: 45_000, detections: 0 },
    { atMs: 50_000, detections: 1 },
    { atMs: 100_000, detections: 1 }
  ])
  loop.recordHeartbeat()
  assert.deepEqual(events, [
    { kind: 'detected', unresponsiveMs: 50_000 },
    { kind: 'resolved', unresponsiveMs: 100_000 }
  ])
  const delayedEvents = []
  now = 0
  const delayed = createHangWatchdogDetectionLoop({
    timeoutMs,
    checkIntervalMs,
    now: () => now,
    onHangDetected: (gap) => delayedEvents.push(gap),
    onHangResolved: () => {}
  })
  for (let tick = 0; tick < 10; tick++) {
    now += 20_000
    delayed.tick()
  }
  assert.deepEqual(delayedEvents, [])
  const markerPath = path.join(scratch, 'marker.json')
  recordHangObservation({
    parentPid: process.pid,
    markerPath,
    unresponsiveMs: 50_000,
    selfRecovered: false
  })
  const marker = consumeHangDetectionMarker(markerPath)
  assert.equal(marker.unresponsiveMs, 50_000)
  assert.equal(marker.selfRecovered, false)
  assert.equal(fs.existsSync(markerPath), false)
  const result = {
    scope: 'Actual detection loop with a deterministic clock and actual marker write/consume. No Electron app or worker is launched.',
    timeoutMs,
    checkIntervalMs,
    observations,
    events,
    delayedWorker: { elapsedMs: now, tickGapMs: 20_000, detections: delayedEvents.length },
    marker: { unresponsiveMs: marker.unresponsiveMs, selfRecovered: marker.selfRecovered, consumed: true },
    sources: Object.fromEntries(sources.map((source) => [source,
      createHash('sha256').update(fs.readFileSync(path.join(root, source))).digest('hex')])),
    bundleSha256: createHash('sha256').update(bundle).digest('hex')
  }
  fs.writeFileSync(path.join(__dirname, 'results.json'), `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  delete require.cache[modulePath]
  fs.rmSync(scratch, { recursive: true, force: true })
}
