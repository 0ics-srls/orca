# Byte accounting and shared-wait boundaries

This follow-up records targeted ownership and capacity reads, including negative
results. The source manifest identifies the exact versions reviewed. It does not
claim every caller, allocation, or asynchronous schedule has been proved safe.

## Collections

| Boundary                                           | Result and remaining limit                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cold-restore-payload-cache.ts`                    | Each entry charges at least 16 bytes, with text and link charges; eviction removes actual oldest entries until the 16 MiB logical budget is met. This does not measure map/key overhead or sliced-string backing storage.                                                                                                                                                                                                                                                |
| `terminal-history-seed-transfer-registry.ts`       | Rejects empty chunks; at most eight transfers and 4,096 chunks per manifest, with an aggregate byte cap. Take, abort, owner cleanup, disposal and 30-second expiry remove entries and timers. Pending native I/O elsewhere is outside this registry.                                                                                                                                                                                                                     |
| `settled-diff-cache.ts`                            | Existing `BoundedMap` supplies independent 32-entry, one-million-character per-result and eight-million-character total caps. Generation/stamp checks fence late writes. This is a retained content budget, not a peak diff allocation measurement.                                                                                                                                                                                                                      |
| `ws-outbound-backpressure-queue.ts`                | Ordinary queueing has byte and frame caps, drain clears consumed slots, and disposal drops the array. Its exposed cancellation API can leave arbitrarily many empty array slots behind an undrained first entry; see the bounded proof below. No production caller uses that cancellation API in this checkout, so this was not promoted as an incident mechanism or fix.                                                                                                |
| `browser-network-tunnel-outbound-memory-budget.ts` | Independent claim, socket-source, lease and host counts prevent zero-byte claims from evading every bound. Releases are idempotent; hosts are deleted only after all owners leave. Claim/socket owners must still call release.                                                                                                                                                                                                                                          |
| `browser-network-tunnel-resource-budget.ts`        | Zero-byte reservations return without appending an aggregate claim. Positive claims are consumed in order, slots cleared and the prefix compacted. Open attempts have a time-window count cap and pending opens a separate cap. Payload byte sizes originate from transport buffers; no arbitrary-number safety claim is made.                                                                                                                                           |
| `mobile-e2ee-outbound-memory-budget.ts`            | Zero-byte claims still charge a frame. A process-level frame cap and socket-source cap complement the byte bounds. Release is idempotent; caller teardown remains necessary.                                                                                                                                                                                                                                                                                             |
| `browser-client-upload-staging.ts`                 | Retained entries describe staged disk paths, not the uploaded buffers. Per-page eviction follows successful staging; failed directory removal deliberately keeps its record for retry. Concurrent pending writes retain their inputs until settlement, and repeated removal failures can retain metadata. Dropping those records would lose cleanup ownership.                                                                                                           |
| `runtime-upload-file-stream.ts`                    | Sequential reads reuse one buffer of at most 384 KiB and await each base64 chunk RPC, with a 30-second RPC deadline, abort checks and handle cleanup in `finally`. Empty files send one empty chunk. This bounds each transfer's read buffer, not concurrent transfers or native filesystem waits.                                                                                                                                                                       |
| `terminal-shell-recovery-barrier.ts`               | The queue flushes on its 262,144-code-unit budget or 750 ms deadline; teardown is explicitly bounded and settles waiters. The byte-named counter counts code units and has no independent emission-count cap. Actual ConPTY ingress can emit empty transformed records for suppressed queries. Its normal native job inspection is synchronous, so proof settlement releases the queue at the next microtask checkpoint; a delayed-proof stress case is qualified below. |
| `codex-structured-acquisition-window.ts`           | Independent 1,024-operation and 4 MiB logical caps, with a minimum one-byte charge. Overflow discards buffered closures and refuses acquisition; drain transfers and removes them.                                                                                                                                                                                                                                                                                       |
| `structured-agent-session-event-sink-queue.ts`     | Ordinary and lifecycle operations have separate byte/count admission; replacement removes the old queued operation. Close/failure drop queued operations and settle barriers. A running operation remains owned until its promise settles; repeated barrier callers during an indefinitely stalled operation need separate admission analysis.                                                                                                                           |
| `orcad-sidecar-runtime-client.ts`                  | Each request limits retained response text to 64 MiB. Its 90-second default timer refreshes on keepalive frames; that is an inactivity deadline, not an absolute lifetime cap. Finish clears the timer and ends the socket; late data remains byte-bounded. Concurrent requests and peer-close behavior remain separate concerns.                                                                                                                                        |

## Cancellation and reconciliation

- `ClaudePromptRegistry` removes claims together with normal prompt retirement
  and stores cancellation observations in a `WeakMap`. Permission callback
  listeners are attached to per-request signals. The installed SDK rejects
  duplicate in-flight request IDs and deletes its controller in `finally` after
  writing the response. A pending response write is still an owner; the normal
  completed-request path is not the Codex claim-map bug fixed in #21138. This is
  source tracing, not a new SDK runtime reproduction.
- `SessionSearchWorkLoop.queue` chains one task per reconcile request; it does
  not coalesce requests. The registry's five-second freshness timeout only ends
  the caller's wait. Desktop calls go through `AiVaultScannerServiceClient`,
  which admits at most 16 queued/active calls, runs one interactive lane, and
  starts a 15-second deadline once the child is ready. Those controls prevent
  treating repeated desktop freshness requests as an uncapped indexer queue.
  In-process relay/orcad registration has a different route and requires its
  own caller admission analysis. Closing the loop aborts the running task and
  prevents queued tasks from executing; native I/O can still outlive that abort.
  The later `notes/session-search-admission-review/` traces 33 source files and
  passes five existing controls: relay installs disabled defaults, orcad's timer
  rearms only after settlement, and no current production caller requests
  `wait-until-current`. Explicit custom freshness RPCs can enqueue work, but no
  ordinary repeating producer of the proposed stalled queue was established.
- The canceled working-directory wait investigation rejected an eager shared
  observer because it changes external raw-promise cancellation ordering.
  [#21144](https://github.com/stablyai/orca/pull/21144) instead clears per-caller
  holders while preserving reaction order and native-operation ownership.
  [Both runtime proofs](../working-directory-wait-retention/README.md) release
  32 canceled signals; small empty reaction/holder records remain until settlement.

## Cancellation-slot diagnostic

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/main-collection-loop-review/outbound-cancellation-slot-probe.cjs
```

The runner transpiles the hash-checked actual queue source without changing it.
It parks one frame, then enqueues and cancels four batches of 2,048 later frames.

Array storage grows from 2,049 to 8,193 slots while retained frames stay at one
and retained/claimed payload bytes stay at five. Canceled slots contain
`undefined`: this is array storage, not retained canceled frame payloads. Draining
the original frame returns slots, frames and byte claims to zero and preserves
output order. The injected scheduler consumes callbacks before invoking them,
as a real timer does.

A repository-wide reference search found `enqueueCancelable` only in the queue
implementation and its tests. Production `enqueue` calls discard the handle.
Consequently, this API-only case is retained as a negative promotion decision;
it does not explain #19831 or establish measured heap/RSS growth. The existing
ordinary drain/compaction and byte/frame caps remain relevant to live callers.

## Terminal recovery follow-up

The actual `PtyStartupIngress` emits a transformed empty record, retaining its raw sequence span, for each suppressed ConPTY color query. Feeding its emissions to the actual recovery barrier reproduces 9,362 queued records from one 65,534-code-unit input before the next microtask checkpoint, charged as zero text. With the normal already-resolved confirmation shape, all later read callbacks see an empty queue.

An injected asynchronous confirmation delay permits eight such reads to retain 74,896 records while the text counter remains zero; the production 750 ms timer then flushes every record and releases the queue. The POSIX no-startup-authority control preserves the queries as ordinary text and trips the byte limit. All three controls pass on Node and Electron using the actual classes, without a native PTY or heap measurement. The bounded runner and reports are retained locally in `notes/terminal-recovery-empty-emissions/`.

The Windows caller obtains job membership synchronously through `readWindowsPtyJobProcessIds` / `QueryInformationJobObject`; an async wrapper alone does not establish a prolonged native wait. The delayed-proof condition is therefore not claimed as an ordinary Windows producer, a sustained leak, or an explanation of the Linux #19831 report. The result corrects the initial assumption that empty emissions required a synthetic input API, while preserving the distinction between within-callback allocation and indefinite retention.

## Structured sink barrier follow-up

Seven actual-source controls in `notes/structured-sink-barrier-waiters/` distinguish
barrier metadata from operation admission. Injecting an asynchronously pending
sink operation and retrying actual host close after each ten-second drain timeout
retains one to 32 barrier waiters. Settling the original operation releases all
of them. Serialized ordinary tasks leave only one active barrier; earlier provider
stop timeouts add none; failure/close settle existing barriers. Actual SQLite
appends and barriers drain with all rows durable.

The reviewed journal row, epoch and close operations use synchronous SQLite.
A native stall in those calls also prevents the retry timers from running.
No ordinary asynchronous operation that would enable the repeated-timeout
condition was established. Release-clock failures do not automatically rearm.
This conditional metadata case is documented, with 32 source hashes, and is not
promoted as a new product fix or incident explanation.
