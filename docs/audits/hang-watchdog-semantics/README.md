# What the hang watchdog can establish for #19768

The [issue follow-up](https://github.com/stablyai/orca/issues/19768#issuecomment-5607771383) reports 17.95 GB within 190 seconds of fork (the reporter estimates about 95 MB/s), and the same main-thread stack in 40/40 and 41/41 samples from separate hangs. That is stronger evidence of a repeating synchronous main-thread path than the original issue title alone. Unsymbolized JIT frames and the reporter's symbolization caveat prevent identifying the function from the quoted stack. A numeric-cycle traversal is one reproduced synchronous allocation mechanism; no actual cyclic macOS process table is established.

The follow-up also infers watchdog failure from a quiet worker during 21–25 seconds of samples. The code narrows that inference:

- The shipped timeout is **45 seconds**, checked every five seconds, with a strict greater-than comparison. With regular ticks and a heartbeat at time zero, first detection is at 50 seconds. The sample duration is not the known duration since the last heartbeat, so it neither proves nor disproves that the threshold was exceeded.
- The worker deliberately **only writes a marker**. It does not kill the main process, emit a live trace breadcrumb, or show a dialog. Startup consumes that marker and writes the `main_thread_hang_detected` breadcrumb on the next launch. Continued process survival and silence in the wedged main trace are therefore compatible with successful detection.
- A worker tick delayed by more than 15 seconds resets the silence timer as a system-sleep heuristic. Repeated worker starvation can consequently suppress detection; the report does not supply worker tick timings that establish this case.

The detection loop, protocol constants, worker entry, and marker implementation are byte-identical between this checkout and `v1.4.198`. The existing #20910 fixes app-listener ownership on watchdog retirement, not these detection semantics. No automatic termination or threshold change is proposed by this audit.

## Portable diagnostic

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/hang-watchdog-semantics/reproduce.cjs
```

The script bundles actual detection and marker code into a temporary Node module. A deterministic clock covers 25, 45, 50, and 100 seconds without waiting; marker I/O uses a temporary file. It confirms one detection, recovery, marker consumption, and the separate delayed-worker reset case. It launches no app, native window, or worker and measures no affected-host memory. Source and bundle hashes are recorded in `results.json`.

This explains the observer's behavior and corrects the evidence summary. The main-process allocation incident remains unattributed; the stats `agent_start` count separately does not prove repeated process creation.
