const { workerData } = require('node:worker_threads')
const counters = new Int32Array(workerData.gate)
exports.createOnlineRecognizer = () => ({})
exports.createOnlineStream = () => ({})
exports.acceptWaveformOnline = (_stream, { samples }) => {
  if (Atomics.load(counters, 0) === 0) {
    Atomics.store(counters, 0, 1)
    Atomics.wait(counters, 1, 0, 10000)
  }
  if (samples.length > 1) {
    const index = Atomics.load(counters, 2) - 1
    if (samples[0] !== index % 10 || samples.at(-1) !== index % 10) {
      throw new Error('Transferred audio payload changed')
    }
  }
  Atomics.add(counters, 3, samples.length)
  Atomics.add(counters, 2, 1)
}
exports.isOnlineStreamReady = () => false
exports.getOnlineStreamResultAsJson = () => '{}'
exports.isEndpoint = () => false
