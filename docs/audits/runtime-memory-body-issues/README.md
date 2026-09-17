# Runtime hang and memory-body issue review

Issue bodies and all comment pages were read from a complete GitHub cache collected on 2026-09-16. This artifact changes no product behavior. It runs against the repository source and installed dependencies; no ignored notes or Git history are needed.

## Classification

| Issue  | Reported version | Audit conclusion                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #11315 | v1.4.160-rc.5    | Main-side SSH output/replay processing fits the sampled process, but no captured Pi ask_user transcript or terminal geometry identifies the exact busy loop. Existing flood/replay limits already existed in that version. Not an attributed memory leak or a reproduced Pi trigger.                                                                                |
| #15098 | v1.4.183         | Report explicitly says main RSS was flat under severe I/O pressure. Source contradicts an intrinsically unbounded Linux quota-probe wait: init, graceful drain, and hard-kill exit waits were already bounded. Current integrated silent-child control returns an error at 36 seconds of timer progress. The reported 31-minute runtime stall remains unattributed. |
| #15882 | v1.4.187         | Report explicitly says stable renderer heap. Later existing changes reduce repeated repository-identity and absent-upstream probes. They are concrete partial matches, not proof of the renderer’s 52% CPU or the entire runtime freeze. Folder scan attribution and exact repeated caller remain unproven.                                                         |
| #19312 | v1.4.197         | Reproduced repeated full scans from finite slow fingerprint reads in actual runtime, both current and reported-version target overlay. This explains the reported branch and avoidable repeated work. Per-repo coalescing bounds simultaneous work; no heap/RSS or event-loop starvation was reproduced.                                                            |

## #19312: finite slow probes force rescans

`src/main/runtime/orca-runtime-refresh-repo-worktree-scan.ts:51–72` awaits the fingerprint for 3,500 ms. Timeout becomes null, so the unchanged-fingerprint fast path is skipped and the full scan runs. `orca-runtime-postlude.ts:35–51` fixes the reconciliation ceiling at five minutes and derives the 3,500 ms budget from the five-second caller budget minus 1,500 ms fallback allowance.

The portable fixture `fingerprint-repetition.test.mjs` derives its setup from the existing `worktree-scan-admin-fingerprint-gate.test.ts` fixture. It invokes actual `OrcaRuntimeService.listResolvedWorktrees`, with finite fingerprint reads and Git listings stubbed, an in-memory store, and inert Electron/SSH dispatch boundaries. Eight probes each return the same fingerprint after exactly four seconds. Eight TTL expirations cause eight extra full scans: **9 total including the initial scan**. A recovery control switches from a four-second probe to three-second probes and stops at two scans total. All raw probes settle; this is not a synthetic permanently stuck task.

The same two controls pass with the exact v1.4.197 refresh module loaded by `historical.config.mts`. Current and reported refresh sources differ only by the later public `invalidateWorktreeCatalog` method, outside the exercised path. The postlude and per-repo cache/in-flight modules are byte-identical. `source-versions.json` records named revision and canonical source hashes. This is a target-source overlay with current dependencies, not a historical application execution.

Limits matter: `startRepoWorktreeAdminFingerprintProbe` at line 80 admits only one raw probe per repo. `orca-runtime-list-known-resolved-worktrees-for-explicit-target.ts:166–205` shares one in-flight refresh per unchanged repo/host/generation and removes it on completion. Its successful result rearms a 30-second TTL. A repeatedly queried fixed repo therefore does not add one new full-scan promise on every poll while an old scan remains queued. Git’s admission state separately bounds active children; the global queued-request count is not bounded by that active-child cap. This fixture demonstrates repeated scan cost, not an unbounded queued-scan or memory claim.

Recommendation: a timeout-specific cache reuse change merits a separate behavior proposal with the five-minute original scannedAt ceiling, real mismatch/null behavior, invalidation, and same-repo concurrency preserved. No candidate or product change was made. The current existing test explicitly expects a scan on timeout, so this is a deliberate fallback-policy change, not dead metadata cleanup.

## #15098: deadlines already exist; timer starvation is not disproved

The reported process command and cwd match the Codex usage RPC subsystem. At v1.4.183, `codex-fetcher.ts:52–53,635,698–716` already defines and arms a 30-second native / 40-second WSL initialization deadline. `codex-probe-termination.ts` already requests stdin EOF and SIGTERM on Linux, waits five seconds, sends SIGKILL, and waits at most another second. Current code splits the RPC reader into `codex-rpc-rate-limit-probe.ts:124–144`; the Linux deadlines remain equivalent. The later termination change adds a Windows tree-kill diagnostic site, not a Linux timeout.

`codex-probe-deadline.test.mjs` combines the actual current reader and termination helper with one inert Linux child that never replies or reports exit. At 30 seconds, stdout listeners detach and SIGTERM is requested; at 35 seconds SIGKILL is requested; at 36 seconds the usage promise resolves with `RPC timeout`. No process is spawned or signaled. This proves the promise wait is bounded when the main event loop can run timers. It does not prove OS process death/reaping, nor bound real wall time when the event loop or host scheduler is starved.

The reported-version `index.ts:3020–3053` headless startup awaits WSL/PTY initialization, restored orchestration authority, and legacy worker reconciliation before starting RPC. It does not directly await the rate-limit result there. The window service starts rate limits without awaiting them (`index.ts:1490–1492`); current `main-window-core-services.ts:134–136` preserves that pattern and `service-configuration.ts:98–104` launches fetches with `void`. This does not exclude an indirect resource interaction, a lock elsewhere, or repeated output preventing timer progress. The issue’s simultaneous agent search, page-in pressure, and fixed 6.7 GB RSS cannot choose among those paths.

Do not label the reported child as unreaped forever based on source, or claim a 36-second wall-clock guarantee during host starvation. The earlier 25-site loop review also records an uncapped incomplete stdout record and repeated initialize-response deadline rearming in this subsystem. No ordinary large-record or repeated-initialize Codex producer was established there or here; those conditional input risks do not explain this silent/wedged-child report. No new memory fix is justified by this incident evidence.

## #15882: existing partial fixes and remaining scope

The report records renderer heap around 93–95 MB, renderer RSS around 858 MB, and a final Git rate of approximately 0.17 calls/second. Counts accumulated over 14 hours do not by themselves prove a synchronous renderer loop.

Two later existing commits concretely address part of its repeated probe surface:

- `67f2fc9e7c7550cd75ae7ffe8f0927b3a7db686b` / #16450 reduces recurring repository identity probes. Reported v1.4.187 still uses a 30-second positive cache in `github-repository-identity.ts:62`.
- `31db2774f8636fa46af1105e84353030bc06ac53` / #18455 skips get-url for absent upstream using `git/remote-name-listing.ts`. Current listing coalesces by execution host and repo, checks config identity, uses a five-minute signed / 30-second unsigned TTL and a 512-entry cap. This commit is not an ancestor of v1.4.187. All seven current fork/owner/repo regression tests passed, including origin-only upstream suppression.

Current `git/repo-default-base-ref.ts:95–115` still treats missing origin/HEAD as a normal fallback to candidate refs. Repeated calls can legitimately issue it again. The hosted-review caller adds its own 30-second cache, in-flight sharing and 15-second aggregate budget (`source-control/repo-default-branch.ts:7–126`). The source-control renderer hook runs on stable repo/host/visibility dependencies and skips folders (`use-base-ref-default.ts:24–60`). No proof ties this caller to the reported aggregate failures.

Folder guards exist at current runtime row resolution (`repo-worktree-row-resolution.ts:107`) and repository ref queries (`runtime-repository-ref-queries.ts:36,58`), plus IPC base-ref queries (`ipc/repos/base-ref-query-handlers.ts:35`). The reported v1.4.187 row resolver already contains the folder early return at line 95, so it is incorrect to call this a subsequently fixed generic folder-scan regression. There may be another producer, but the report’s aggregate rev-parse count does not identify it. No broad negative-cache policy was added.

## #11315: SSH parsing fits process location, but no exact Pi trigger

Reported v1.4.160-rc.5 routes SSH transport bytes through `ssh-channel-multiplexer.ts` and `providers/ssh-pty-notification-routing.ts` to main runtime output consumers. Its monolithic `orca-runtime.ts:7717` performs onPtyData handling and creates/feeds the main headless emulator. Current equivalents are `orca-runtime-on-pty-data.ts:19`, `orca-runtime-maybe-hydrate-headless-from-renderer.ts:161`, and `orca-runtime-create-pty-headless-terminal-state.ts:14`. Therefore an idle local daemon and renderer do not exclude substantial SSH parsing or emulator work in main; the sampled NodeBIO/stream callback stack alone does not identify the JavaScript operation.

Main reply ownership is gated per chunk by hidden delivery and remote viewer state. Replayed snapshots suppress terminal query replies; active-owner checks prevent old emulator replies from reaching a replacement. **107 current query-authority/reply tests pass**, including replay and ingestion-time ownership controls. These are generic protocol controls, not Pi ask_user transcript reproductions.

The known foreground restore feedback guard is already in reported-version `pty-connection.ts:319–330`: two-second flood suppression and at most three iterations per restore task. Its invocation checks appear at lines 7043 and 7123–7128. Thus the current split module’s rc.7.perf comment does not establish that v1.4.160-rc.5 lacked the mitigation. The warning banner says skipped hidden output could not be restored; it is not a diagnosis of the CPU trigger.

Existing memory fixes for retained text tails, delivery backpressure, or xterm reflow remain mechanism-level controls. No actual Pi transcript, applied dimensions, parent allocation, or repeated owner-retirement path connects one to this report. Do not infer a resize loop from a screenshot or synthesize a remembered Pi screen; repository transcript policy applies. No new product change is proposed from this bounded review.

## Reproduction and evidence

All commands require `ORCA_BACKGROUND_LAUNCH=1`. The fixtures use no application window, native PTY, network, or affected host. Run from the repository root with dependencies installed:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config docs/audits/runtime-memory-body-issues/config.mts --reporter=json --outputFile=docs/audits/runtime-memory-body-issues/current-results.json
ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config docs/audits/runtime-memory-body-issues/historical.config.mts --reporter=json --outputFile=docs/audits/runtime-memory-body-issues/reported-results.json
ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config config/vitest.config.ts src/main/github/github-repository-identity.fork-owner-repo.test.ts src/main/runtime/worktree-scan-admin-fingerprint-gate.test.ts src/main/runtime/terminal-model-query-authority.test.ts src/main/runtime/terminal-query-responder.test.ts --reporter=json --outputFile=docs/audits/runtime-memory-body-issues/controls-results.json
```

Expected: current fixtures 3/3, v1.4.197 target overlay 2/2, and existing controls 138/138. The history config reverses only `reported.patch` in memory and checks exact source hashes. All other product dependencies remain current. The shared source reader also verifies the thirty manually reviewed current boundary modules against `source-versions.json`; it is not an exhaustive lock of every imported dependency. Named historical hashes are provenance from the reviewed revisions, not a claim those entire revisions were executed.

Tests use fake timers to exercise finite delays. They do not measure actual CPU, RSS or filesystem load. `validation.json` records artifact identities and validation commands. No result from the initially interrupted wider discovery command in the private investigation is included.
