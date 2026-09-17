const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { transformSync } = require('esbuild')

assert.equal(process.env.ORCA_BACKGROUND_LAUNCH, '1')
const root = path.resolve(__dirname, '../../..')
const sourcePath = 'src/shared/ws-outbound-backpressure-queue.ts'
const source = fs.readFileSync(path.join(root, sourcePath), 'utf8')
const sourceSha256 = createHash('sha256').update(source).digest('hex')
assert.equal(sourceSha256, '73bf7ff3c10c42ada557045ac4be57f7676b87678984985f2dfe1b99a6e23e17')
const bundle = transformSync(source, { loader: 'ts', format: 'cjs' }).code
const loaded = new Module(__filename, module)
loaded._compile(bundle, __filename)
const { createWsOutboundBackpressureQueue } = loaded.exports
let timer = null
let buffered = 100
let claimed = 0
const sent = []
const queue = createWsOutboundBackpressureQueue({
  send: (frame) => sent.push(frame),
  byteLengthOf: (frame) => frame.length,
  getBufferedAmount: () => buffered,
  isWritable: () => true,
  onOverflow: () => assert.fail('No retained frame or byte bound was exceeded'),
  softCapBytes: 10,
  claimQueuedBytes: (bytes) => {
    claimed += bytes
    return () => {
      claimed -= bytes
    }
  },
  setTimer: (callback) => {
    timer = callback
    return 1
  },
  clearTimer: () => {
    timer = null
  }
})
assert.equal(queue.enqueue('owner'), true)
const batches = []
for (let batch = 0; batch < 4; batch++) {
  for (let index = 0; index < 2048; index++) {
    const result = queue.enqueueCancelable('discard')
    assert.equal(result.accepted, true)
    assert.equal(result.cancel(), true)
    assert.equal(result.cancel(), false)
  }
  const evidence = queue.evidence()
  assert.equal(evidence.queuedFrames, 1)
  assert.equal(evidence.queuedBytes, 5)
  assert.equal(evidence.storageSlots, (batch + 1) * 2048 + 1)
  assert.equal(claimed, 5)
  batches.push(evidence)
}
buffered = 0
assert.equal(typeof timer, 'function')
const drain = timer
timer = null
drain()
assert.deepEqual(sent, ['owner'])
assert.deepEqual(queue.evidence(), { queuedBytes: 0, queuedFrames: 0, storageSlots: 0 })
assert.equal(claimed, 0)
assert.equal(timer, null)
queue.dispose()
const report = {
  sourcePath,
  sourceSha256,
  runnerSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  evaluatedBundleSha256: createHash('sha256').update(bundle).digest('hex'),
  runtime: process.versions,
  batches,
  afterDrain: queue.evidence(),
  productionReachability:
    'No production reference to enqueueCancelable found in checked-out repository; ordinary enqueue discards cancellation handle. API-only capacity gap, not promoted as an incident explanation or product fix.',
  scope:
    'Canceled slots contain undefined; retained frame payloads and byte claims are released. No heap or RSS measurement.'
}
fs.writeFileSync(
  path.join(__dirname, 'outbound-cancellation-slot-results.json'),
  `${JSON.stringify(report, null, 2)}\n`
)
console.log(
  JSON.stringify({
    batches: batches.length,
    maximumSlots: batches.at(-1).storageSlots,
    afterDrain: report.afterDrain
  })
)
