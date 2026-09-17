# Speech worker audio delivery budget

Status: **baseline diagnostic of a conditional retention mechanism; later fixed in #21129; no incident attribution**.

The baseline `SttService.feedAudio` transfers each audio buffer to a Node worker without an acknowledgment or byte budget. The real worker decodes synchronously inside its message handler. If decoding stops making progress, later transferred buffers remain in the worker's message queue, outside the main isolate's ordinary JavaScript heap.

## Reproduce

```sh
ORCA_BACKGROUND_LAUNCH=1 node --expose-gc --max-old-space-size=128 docs/audits/speech-worker-audio-queue/reproduce.cjs
```

The fixture bundles the actual service and worker with the later audio-budget patch reversed in memory through the sibling `speech-worker-audio-budget/sources.cjs` module. That module verifies original source hashes. Service lifecycle imports are replaced with minimal state/start/stop ports; the original feed method and complete original worker message handler execute. The native recognizer is a fixture: its first waveform call waits on a shared semaphore, with a ten-second fallback deadline. This deliberately models a stalled decoder; it does not reproduce a natural sherpa/ONNX stall or measure inference speed. No microphone, model download, Electron window, or network is used. Reports record both current checkout hashes and the restored source hashes actually evaluated.

The subsequent fix and complete actual-lifecycle before/after proof are in [speech-worker-audio-budget](../speech-worker-audio-budget/README.md), published as [#21129](https://github.com/stablyai/orca/pull/21129). This earlier diagnostic remains useful for its isolated RSS/main-heap observation.

After that first call enters the stall, the service transfers 1,024 frames of 4,096 float samples, the same frame length as the renderer's capture callback. All source buffers detach. The worker has consumed none of these frames when memory is sampled: **16,777,216 payload bytes remain queued**. Releasing the semaphore drains every frame, and the recognizer checks payload values and the total sample count. The worker is then terminated and the temporary bundles are removed. Three admission controls verify stopping, absent ownership, and foreign ownership do not transfer a frame.

| Runtime                       | Queued payload | Process RSS increase | Main isolate heap increase |
| ----------------------------- | -------------: | -------------------: | -------------------------: |
| Node 26.6.0                   |         16 MiB |     17,432,576 bytes |             −161,520 bytes |
| Electron 43.7.0, Node 24.21.0 |         16 MiB |     17,694,720 bytes |               21,652 bytes |

`results.json` and `electron-results.json` include source/proof hashes, complete memory samples, and runtime versions. RSS measures the process including its worker; the small main-isolate heap and external deltas do not count queued payload ownership. Allocator reuse and forced-GC timing affect these samples. Payload byte accounting comes from verified transfers and drain, not a heap-size estimate.

The Electron result uses the installed executable in `ELECTRON_RUN_AS_NODE=1` mode. It is not the historical Electron 43.4.1 binary. On this macOS checkout:

```sh
ELECTRON_RUN_AS_NODE=1 ORCA_BACKGROUND_LAUNCH=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --expose-gc --max-old-space-size=128 docs/audits/speech-worker-audio-queue/reproduce.cjs docs/audits/speech-worker-audio-queue/electron-results.json
```

## Reachability and limits

The renderer sends live 4,096-sample frames without waiting for earlier IPC replies. The main `speech:feedAudio` handler resolves after posting to the worker, not after decoding. Renderer startup buffering has separate 30-second/8-MiB limits, and offline decoding limits each accepted chunk to about 30 seconds; neither limit bounds messages waiting to enter the worker's handler. The service's feed implementation is byte-identical in `v1.4.198`; `versions.json` records that comparison.

This proof injects a stall and sends frames faster than real-time capture. Ordinary mono capture generates about 64,000 payload bytes per second at 16 kHz, or 192,000 at 48 kHz. It therefore does **not** explain the reported approximately 95-MB/s lifetime-average allocation estimate in #19768. Neither #19768 nor #19831 establishes active dictation, a slow decoder, or this queue's size.

A safe delivery limit needs an explicit overload outcome. Simply rejecting feed calls would silently discard audio because the live capture callback catches and ignores those failures; adding only a worker acknowledgment would move buffering upstream unless capture admission also changes. Those behavioral decisions are outside this diagnostic. No silent audio dropping, arbitrary model cap, or new background worker is proposed here.

## Native stream ownership follow-up

The pinned dependency's [offline ASR wrapper](https://github.com/k2-fsa/sherpa-onnx/blob/v1.12.37/harmony-os/SherpaOnnxHar/sherpa_onnx/src/main/cpp/non-streaming-asr.cc) and [online ASR wrapper](https://github.com/k2-fsa/sherpa-onnx/blob/v1.12.37/harmony-os/SherpaOnnxHar/sherpa_onnx/src/main/cpp/streaming-asr.cc) register native finalizers for recognizers and streams. Each calls the matching destroy function. Replacing a JavaScript stream reference therefore does not, by itself, prove a missing native destructor.

No external-memory accounting call appears in those two wrapper files. This is a limited source observation, not a measurement of model allocation or GC timing. `native-sources.json` records exact URLs and hashes; no real model was loaded. The node-addon source paths are symlinks to these shared wrappers in the official tag.

Independent rerun confirmed all transferred frames drain and passed 35 existing service/worker/desktop/mobile tests. Existing errors already reach desktop error-and-stop handling; mobile's five-second pending-audio limit covers RPC completion, which occurs before worker decoding. Stop fences further feeds, but its 60-second fallback invokes worker termination without awaiting completion. That deadline is not proof that native memory was reclaimed.
