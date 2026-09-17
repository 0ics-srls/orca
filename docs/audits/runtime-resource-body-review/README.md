# RPC wait and worker-record issue review

This review separates three issue-body matches from incident heap attribution.
All bodies and comments were read from the complete cached GitHub responses.

## #19342: shared long-poll capacity

The current classifier assigns both waiting `orchestration.check` calls and
`orchestration.workerStart` to the `wait` class. Admission applies a global
16-request cap, with additional sub-caps only for asks and browser hosts.
Consequently 16 waiting checks can refuse worker-start even on an otherwise idle
machine. Short checks bypass that counter. The server constructor accepts an
internal `longPollCap` option; this review found no production caller supplying
it. This is an admission-policy gap, not evidence of unlimited retained requests.

`long-poll.test.mjs` uses actual authentication, classification, admission and
release methods with controlled finite dispatcher completions. Sixteen checks
are accepted; worker-start is refused; a short check succeeds; settling one held
check allows worker-start; settling the rest returns the count to zero. The
fixture constructs the actual admission prototype with explicit normal counters
and limits, and starts no socket or worker. It does not reproduce host load.

The classifier and admission modules are byte-identical at the current audit
checkpoint, named main checkpoint, v1.4.197 and v1.4.198. The existing
[transport admission proof](../rpc-inflight-admission-review/README.md) separately
covers socket-close cleanup and the distinction between ordinary and long polls.

## #19660: local caller deadline is discarded

The local `callRuntimeRpc` branch still forwards only method and params. The
preload invokes IPC directly; main dispatch does not receive the caller's signal.
Two current-client controls show a local request staying pending past its
15-second requested deadline and a later abort, then settling when the controlled
IPC reply arrives. A pre-aborted call is rejected before dispatch. Fake timers
bound the test; no naturally stalled Automations call or heap growth is claimed.

The reporter already has [PR #19662](https://github.com/stablyai/orca/pull/19662),
verified open at `3182aab1d6369eba360bfef8374db15536e18a96`. It adds a caller-side
deadline. As its description explicitly says, that does not cancel underlying
main-process work; late mutation completion remains possible. This audit does
not duplicate that PR or claim its author's reported tests as our own. Historical
client hashes differ, so the source manifest does not claim whole-file parity.

## #19388: settled-worker release policy

The reporter explicitly says manually releasing the backlog did not materially
reduce the observed memory pressure because most underlying processes had exited.
Current `deriveWorkerTerminalListState` labels owned succeeded/failed dispatches
`reclaimable`; this is a release eligibility state, not a heap measurement.
`workerRelease` requests durable release and rechecks exact ownership before
closing anything. Completion updates the SQLite resource row to `released`; it
does not delete the dispatch/resource history. Retention policy for that history
and process release are distinct operations.

The reviewed release method, completion path and ownership derivation do not
schedule new automatic releases. This is a scoped source observation, not proof
that every scheduler in the repository was examined. The current listing path
also has bounds: at most 5,000 rows per retained snapshot, 32 snapshots, 4 MiB of
accounted content total and 512 KiB per snapshot. These are logical accounting
bounds, not exact JavaScript heap limits or historical incident measurements.
Snapshot state belongs to a WeakMap keyed by runtime; active release entries are
removed in `finally`.

Adding an automatic release policy would change ownership behavior. No timer,
process kill, history deletion or arbitrary retention age was added in this audit.

## Reproduce

```sh
ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run --config docs/audits/runtime-resource-body-review/vitest.config.mjs
```

Three controls pass. `source-versions.json` records the three executed target
hashes, other manually read sources and named historical comparisons. The config
rejects changed executed targets; surrounding dependencies use the current
checkout. This is a Node source-level experiment, not an Electron renderer, a
historical application installation, an RSS benchmark or an affected-host trace.
