# `agent_start` counts working turns, not operating-system spawns

Issue #19768 interprets 44 `agent_start` entries in `orca-stats.json` as 44 Codex respawns. In both current source and the reported `v1.4.198`, these events come from `AgentSessionTransitionRecorder`: each live transition into `working` calls `StatsCollector.onAgentStart`, and leaving `working` records a stop. One unchanged pane can produce many such pairs. The aggregate name `totalAgentsSpawned` does not change this recording behavior.

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/agent-start-count-semantics/reproduce.cjs
```

The script bundles and loads the actual transition recorder, sends synthetic hook states, and records its output callbacks. It creates no provider process and removes its temporary module afterward. Source and bundle hashes are recorded in `results.json`.

| Inputs on one unchanged pane        | `agent_start` callbacks |
| ----------------------------------- | ----------------------: |
| 44 working/done turns               |                      44 |
| 44 identical live working refreshes |                       1 |
| 44 replayed working refreshes       |                       0 |

This corrects an inference about event semantics; it does not establish what hook sequence occurred in the incident or prove that no actual respawns occurred. The separately measured main-process footprint growth remains evidence independent of the stats count. Failed terminal worker start deliberately preserves its created PTY for explicit worker release, which can retain resources if starts really repeat, but this policy plus the stats count alone does not prove an automatic 44-spawn loop.

Production wiring is `src/main/startup/main-process-observers.ts` → `AgentSessionTransitionRecorder.onStatus` → `src/main/stats/collector.ts`. Actual PTY spawn telemetry uses the distinct `agent_started` event in the IPC/runtime spawn-commit paths. The existing transition-recorder suite already tests repeated working/done turns; this audit adds a portable diagnostic, not a production behavior change.

The reported tag keeps failed-start handling in `src/main/runtime/rpc/methods/orchestration-workers.ts` and `failWorkerStartWithReceipt`, which returns a failure receipt with `residual_resources` instead of killing a created terminal. The newer `failed-worker-start-teardown.ts` extraction states the same custody policy explicitly; that filename itself was absent from the tag. Neither path turns a stats working edge into a spawn request. Independent review reran all 14 existing transition-recorder tests.
