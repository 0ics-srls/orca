# Reconnect replay capacity follow-up (2026-09-16)

Read-only follow-up for [#11943](https://github.com/stablyai/orca/issues/11943) and [#12931](https://github.com/stablyai/orca/issues/12931). Issue bodies were read together with one GitHub GraphQL query; no comments or messages were fetched or sent. Cached response: `/tmp/orca-reconnect-issue-bodies.json`.

## Outcome

An executable bounded comparison reproduces a historical reconnect reply capacity failure, already addressed by [#17968](https://github.com/stablyai/orca/pull/17968), commit `99d9111653d27621b36e00b4e2c79009952a342a`. No new production fix is proposed.

Both current source and the #11943 reported tag, `v1.4.163`, reconnect through `attachForReconnect` with `suppressReplayNotification: true`; the session uses eight reattach workers. Therefore counting retained PTYs and pointing at the separate `pty.replay` notification lane does not itself establish the report's claimed reconnect route. Inline RPC replies still share the 1 MiB control budget.

The real `PtyHandler.attach`, capped `RecentPtyOutputBuffer`, frame decoder/codec, dispatcher response method, writer admission and settlement run in `replay-fixture.test.ts`. Eight managed PTY records are injected as fixtures, using the test runner PID only for the existing signal-zero liveness check. No native PTY is spawned or killed. One sink fixture acknowledges each write on the next `setImmediate`; replies from the same decoded request batch can therefore coexist before settlement. This models a bounded asynchronous write delay, not an indefinitely stalled sink. The baseline restores only fatal admission on the first RPC response enqueue; targeted reads confirm that policy, replay cap and worker count in `v1.4.163`. It is not a complete historical binary run.

| Scenario | Historical admission | Current source |
| --- | --- | --- |
| Eight 102,400-code-unit ASCII replay replies | Eight delivered, zero closes | Eight delivered, zero closes |
| Eight capped ANSI replay replies | Five delivered, sixth closes connection | Five delivered, three request capacity errors, zero closes |
| Eleven ASCII legacy replay notifications, suppression disabled | Tenth fits; eleventh closes | Tenth fits; eleventh closes |

ANSI uses repeated red `X` plus reset (`ESC[31mX ESC[0m`, without the displayed separator). JSON escaping doubles this capped tail's wire size to about 204,884 bytes per reply. Five replies occupy 1,024,420 bytes; another cannot fit in the 1,048,576-byte shared budget. Three independent attempts with the same fixed input reproduce the same outcome. PTY record counts remain eight in every attempt, so this is not a PTY accumulation or heap-growth proof. The automatic client reconnect scheduler and actual network throughput are not exercised. Source-credit recovery is a separate route; this fixture exercises the supported inline-replay fallback.

The current legacy notification overflow is recorded as a control, not a demonstrated ordinary reconnect trigger. Current and historical reconnect callers suppress it. A proof of some other caller using that route during the field incident would be needed before attributing the report to it.

## Client-close interpretation

In both current source and `v1.4.163`, transport `onClose` calls `dispose('connection_lost')`; `watchMuxForRelayLoss` handles that reason. The issue's generic `reason === 'connection_lost'` error-message snippet therefore does not prove that a relay capacity close is classified as permanent shutdown. Cleanup after failed establishment can still produce a later shutdown error; that precise field sequence has not been demonstrated here. The historical source route reproduced above reports `Relay control queue exceeded its bounded capacity`, whereas the issue quotes `Relay control publication capacity exceeded`; the exact logged publication remains unattributed.

## #12931 limits

This report identifies relay build `0.1.0+8de1d39fd7c1`, without an exact desktop release, and logs EPIPE/socket-close after watcher canary exits. It supplies no capacity error or frame trace connecting the canary to a particular overflowing publication. Current watcher recovery resubscribes records or trips its crash fuse; the canary avoids probes during subscription activity, and event delivery coalesces overflow rather than retaining unlimited events. These source facts do not prove the historical build recovered or identify its later channel failure. No watcher-to-EPIPE causal sequence was reproduced. `--grace-time 0` intentionally preserves live PTYs; absence of reaping under that configuration is not itself a leak.

No affected-host memory evidence is available. Neither incident is explained as a memory leak by this experiment.

## Run

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/relay-replay-overflow/reproduce.mjs
```

The runner uses the installed Vitest binary through the shared process launcher. It caps each variant at 45 seconds and 512 MiB, verifies three passing tests in each, removes temporary files, and emits combined JSON. The checked-in `results.json` records those observations, runtime provenance, current source hashes, historical-tag source hashes and explicit historical source checks. No application window opens.

### Watcher controls

A separate current-source run passed 23 focused tests (33 other cases skipped), including actual canary entry logic, bounded event delivery, supervisor resubscription and its crash fuse. Native watchers and child processes are test doubles; these controls do not reproduce an EPIPE-producing SSH reconnect. `watcher-validation.json` records the passing cases and hashes.

```sh
ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/ipc/parcel-watcher-process.test.ts src/main/ipc/parcel-watcher-process-entry.test.ts src/main/ipc/parcel-watcher-crash-fuse.test.ts --testNamePattern='respawns after a crash|disables watching after repeated crashes|canary|opens after three crashes|stays open|expires crashes'
```
