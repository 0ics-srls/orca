const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { Worker } = require('node:worker_threads')
const esbuild = require('esbuild')
const {
  originalSourcePlugin,
  sourceHashes: restoredSourceHashes
} = require('../speech-worker-audio-budget/sources.cjs')

assert.equal(process.env.ORCA_BACKGROUND_LAUNCH, '1')
assert.equal(typeof global.gc, 'function')
const root = path.resolve(__dirname, '../../..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-speech-queue-'))
const gate = new SharedArrayBuffer(16)
const counters = new Int32Array(gate)
const frames = 1024
const samplesPerFrame = 4096
const ports = {
  'stt-session-start': 'exports.startSttDictation = async () => {}',
  'stt-session-stop':
    'exports.stopSttDictation = async () => {}; exports.prepareSttModelForDeletion = async () => {}',
  'stt-session-state':
    'exports.createSttSessionState = () => ({activeOwner:"desktop", stopping:false, worker:null, cloudSession:null})'
}
let worker

function waitFor(check, label) {
  const deadline = Date.now() + 8000
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (check()) {
        return resolve()
      }
      if (Date.now() > deadline) {
        return reject(new Error(`Timed out: ${label}`))
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, 'src/main/speech/stt-service.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(scratch, 'service.cjs'),
    plugins: [
      originalSourcePlugin(),
      {
        name: 'lifecycle-ports',
        setup(build) {
          build.onResolve({ filter: /\/stt-session-(start|stop|state)$/ }, (args) => ({
            path: path.basename(args.path),
            namespace: 'ports'
          }))
          build.onLoad({ filter: /.*/, namespace: 'ports' }, (args) => ({
            contents: ports[args.path],
            loader: 'js'
          }))
        }
      }
    ]
  })
  await esbuild.build({
    entryPoints: [path.join(root, 'src/main/speech/stt-worker.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(scratch, 'worker.cjs'),
    plugins: [originalSourcePlugin()]
  })
  fs.copyFileSync(
    path.join(__dirname, 'stalled-recognizer.cjs'),
    path.join(scratch, 'recognizer.cjs')
  )
  worker = new Worker(path.join(scratch, 'worker.cjs'), {
    workerData: { sherpaModulePath: path.join(scratch, 'recognizer.cjs'), gate },
    resourceLimits: { maxOldGenerationSizeMb: 64 }
  })
  const errors = []
  let ready = false
  worker.on('error', (error) => errors.push(String(error)))
  worker.on('message', (message) => {
    if (message.type === 'ready') {
      ready = true
    }
    if (message.type === 'error') {
      errors.push(message.error)
    }
  })
  worker.postMessage({
    type: 'init',
    modelDir: scratch,
    modelType: 'transducer',
    streaming: true,
    sampleRate: 16000,
    files: ['tokens.txt', 'encoder.onnx', 'decoder.onnx', 'joiner.onnx']
  })
  await waitFor(() => ready || errors.length, 'worker ready')
  assert.deepEqual(errors, [])
  const { SttService } = require(path.join(scratch, 'service.cjs'))
  const service = new SttService({})
  service.state.worker = worker
  const stoppingSamples = new Float32Array([2])
  service.state.stopping = true
  service.feedAudio(stoppingSamples, 16000)
  assert.equal(stoppingSamples.byteLength, 4)
  service.state.stopping = false
  const ownerlessSamples = new Float32Array([3])
  service.state.activeOwner = null
  service.feedAudio(ownerlessSamples, 16000)
  assert.equal(ownerlessSamples.byteLength, 4)
  service.state.activeOwner = 'desktop'
  const foreignSamples = new Float32Array([4])
  assert.throws(() => service.feedAudio(foreignSamples, 16000, 'other'), /dictation_owner_mismatch/)
  assert.equal(foreignSamples.byteLength, 4)
  service.feedAudio(new Float32Array([1]), 16000)
  await waitFor(() => Atomics.load(counters, 0) === 1, 'decoder stalled')
  global.gc()
  const baseline = process.memoryUsage()
  let detached = 0
  for (let index = 0; index < frames; index++) {
    const samples = new Float32Array(samplesPerFrame).fill(index % 10)
    service.feedAudio(samples, 16000)
    if (samples.byteLength === 0) {
      detached++
    }
  }
  global.gc()
  const held = process.memoryUsage()
  assert.equal(detached, frames)
  assert.equal(Atomics.load(counters, 2), 0)
  Atomics.store(counters, 1, 1)
  Atomics.notify(counters, 1)
  await waitFor(() => Atomics.load(counters, 2) === frames + 1 || errors.length, 'audio drained')
  assert.deepEqual(errors, [])
  assert.equal(Atomics.load(counters, 3), frames * samplesPerFrame + 1)
  global.gc()
  const drained = process.memoryUsage()
  await worker.terminate()
  worker = undefined
  global.gc()
  const terminated = process.memoryUsage()
  const sources = Object.fromEntries(
    [
      'src/main/speech/stt-service.ts',
      'src/main/speech/stt-worker.ts',
      'src/main/speech/stt-audio-resample.ts',
      'src/main/speech/stt-offline-audio-chunker.ts',
      'src/renderer/src/hooks/use-audio-capture.ts',
      'src/main/ipc/speech.ts',
      path.relative(root, __filename),
      path.relative(root, path.join(__dirname, 'stalled-recognizer.cjs'))
    ].map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex')
    ])
  )
  const report = {
    runtime: process.versions,
    sources,
    restoredSourceHashes,
    frames,
    samplesPerFrame,
    queuedTransferredBytes: frames * samplesPerFrame * 4,
    detached,
    receivedFrames: Atomics.load(counters, 2),
    receivedSamples: Atomics.load(counters, 3),
    admissionControls: [
      'stopping drops without transfer',
      'no owner drops without transfer',
      'foreign owner rejects without transfer'
    ],
    baseline,
    held,
    drained,
    terminated,
    errors
  }
  fs.writeFileSync(
    process.argv[2] || path.join(__dirname, 'results.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
  console.log(
    JSON.stringify({
      frames,
      queuedTransferredBytes: report.queuedTransferredBytes,
      detached,
      receivedFrames: report.receivedFrames,
      rssDelta: held.rss - baseline.rss,
      heapDelta: held.heapUsed - baseline.heapUsed,
      externalDelta: held.external - baseline.external
    })
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    Atomics.store(counters, 1, 1)
    Atomics.notify(counters, 1)
    if (worker) {
      await worker.terminate()
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  })
