# Renderer exit 5 and low sampled heap: #10382

The source explains the telemetry limits and repeated recovery in
[#10382](https://github.com/stablyai/orca/issues/10382). It does not identify the
allocation, native failure or application action that caused the eight deaths.

## Reported-version behavior

The reported v1.4.152 tag resolves to source commit
`ea2d3e05d664ab21ba35b5272004398daf2884cd`. Its annotated tag object is a different
Git object; the manifest records the source commit explicitly.

- The renderer samples `performance.memory` at startup and every 60 seconds.
  It does not read heap at the instant main receives process-gone. The latest
  25 MB sample is neither renderer RSS nor a crash-instant heap measurement.
- The same legacy API supplies the 3586 MB reported limit. It is not a process
  footprint ceiling. The comment's quantizer buckets and approximately 20-minute
  cache duration were not independently reproduced; minute sampling and heap-only
  scope already prevent ruling out memory pressure from these values.
- Main calls `getAppMetrics()` after process-gone. The returned surviving main,
  GPU and utility rows do not reconstruct the dead renderer's memory. A zero
  renderer count means no returned row, not zero pre-crash footprint.
- The crash recorder preserves Electron's reason and exit code. Current POSIX
  decoding displays raw 5 as SIGTRAP; that label does not distinguish a V8 OOM,
  a native CHECK or another fault. Missing JS error/rejection breadcrumbs cannot
  exclude native failure. The historical ring holds 30 global entries without
  renderer-generation identity.
- Recovery permits three reloads per 60 seconds. Every reported interval is at
  least 84 seconds, so each previous recovery ages out and all eight are allowed.
  This explains continued recovery, not the crash trigger or recurrence cadence.

Exact historical anchors: [sampler](https://github.com/stablyai/orca/blob/ea2d3e05d664ab21ba35b5272004398daf2884cd/src/renderer/src/lib/crash-diagnostics.ts#L24),
[process metrics](https://github.com/stablyai/orca/blob/ea2d3e05d664ab21ba35b5272004398daf2884cd/src/main/crash-reporting/process-gone-diagnostics.ts#L65),
[classification](https://github.com/stablyai/orca/blob/ea2d3e05d664ab21ba35b5272004398daf2884cd/src/main/crash-reporting/process-gone-classification.ts#L63),
[recovery caller](https://github.com/stablyai/orca/blob/ea2d3e05d664ab21ba35b5272004398daf2884cd/src/main/window/createMainWindow.ts#L498).

## Later improvements and remaining limits

[#10683](https://github.com/stablyai/orca/pull/10683) adds direct preload V8 heap
statistics and a `heapSource` tag, with legacy fallback.
[#16449](https://github.com/stablyai/orca/pull/16449) adds asynchronous renderer
private-memory sampling. Current sampling publishes the previous completed
footprint while requesting the next one. Its `outsideHeapMB` is a lagged,
rounded and clamped residual; it is not an exact simultaneous attribution of
native allocations. Reset fencing and one in-flight read prevent stale settlement
from reviving old sampler state. These changes improve measurement; they are
not established fixes for the reported deaths.

The issue comments' aggregate bundle analysis remains reported evidence. The raw
dataset was unavailable to this audit. Neither its low-heap cohort nor its
near-limit cohort establishes a common causal mechanism.

## Verification

The agent passed 89 existing tests covering heap/process readers, diagnostics,
classification, process metrics, recovery and signal decoding. Five additional
controls execute six hash-checked v1.4.152 source modules with controlled telemetry
and time: minute sampling, crashed/5 classification, the eight recovery intervals,
survivor-only metrics and the global breadcrumb ring. Root independently reran
all five controls. No historical application binary or Chromium quantizer was run.

`source-hashes.json` records 25 current repository files matching named main
`291b4ddd6f1c1af480169885e0fda7f9c78ff053`, installed Electron API declarations,
and ten targeted historical sources. `probe-results.json` records the five
controls and runner/source-manifest identities. The local runner, exact source
exports, complete review and test report remain in
`notes/issue-10382-telemetry/`; they are not bundled into this durable summary.

```sh
ORCA_BACKGROUND_LAUNCH=1 node notes/issue-10382-telemetry/probe.cjs
```

No product change, host diagnostic request, application launch or affected-host
root-cause attribution is made here. The concrete crash cause remains open.
