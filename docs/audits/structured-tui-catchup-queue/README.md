# Structured TUI catch-up queue: conditional retention

This diagnostic exercises the actual `StructuredTuiTranscriptCatchup`,
`StructuredAgentSessionTaskQueue`, and keyed serialization implementation. File
discovery, transcript subscription, and journal I/O are stubbed. An explicitly
blocked earlier task represents a session mutation that has not settled.

```sh
ORCA_BACKGROUND_LAUNCH=1 node --expose-gc --max-old-space-size=128 docs/audits/structured-tui-catchup-queue/reproduce.mjs
```

Two hundred synthetic decoded messages contain 25 MiB of text. While the prior
task is blocked, each scheduled append retains its message batch. Stopping the
catch-up watcher prevents publication but does not detach those queued closures.
All 200 messages remain reachable after stop; once the queue drains, none remain.
The recorded heap returns from about 30 MiB to about 5 MiB. Weak references check
message reachability after forced GC; results also record source hashes.

This proves a conditional queue retaining path, not a naturally stalled journal,
a production growth rate, or an incident cause. The queued-append retaining path also exists in `v1.4.198`. The current acquisition-cancellation fix in #21006 does not cancel tasks already admitted to this queue. It requires a structured session handed to a TUI; the issue reports
do not establish that route. Active readable journals intentionally retain their
conversation projection too, so an active-history memory measurement cannot by
itself distinguish a queued copy from intended history.

No production patch accompanies this diagnostic. Introducing backpressure must
preserve transcript cursor/recovery semantics and avoid deadlocking preparation
against activation on the same serialized session queue. Ordinary forward/reverse
handoff cleanup is serialized; host teardown stops watchers before draining other
owners. The reproduction deliberately calls stop while that queue is blocked and
does not establish how often this overlap occurs in production.
