# Memory leak audit coverage (2026-09-15)

This ledger records repository-wide mechanical searches and targeted manual
retaining-path reviews using the `memory-leak-audit` and `memory-leak-debugging`
skills. Source ownership was split across agents; all reads and edits use this
worktree. Coverage is not a claim that every line has been manually proven leak-free
or that every field incident has a demonstrated root cause.

## Coverage

| Area | Files scanned | Audit owner | Status |
|---|---:|---|---|
| `src/renderer` | tracked TS/TSX/JS/JSX | renderer agent | scanned; HMR and parked-tab lifecycle fixes |
| `src/main` | tracked TS/TSX/JS/JSX | main agent | scanned; relay teardown fix |
| `src/preload` + `src/shared` | tracked TS/TSX/JS/JSX | preload/shared agent | scanned; one low-risk fix |
| `mobile` | tracked TS/TSX/JS/JSX | root | scanned; shared xterm hyperlink fix now covers its WebView |
| `cloud` | tracked TS/TSX/JS/JSX | root | scanned; no valuable leaks found |
| `tests` | tracked TS/TSX/JS/JSX | root + area owners | scanned; fixtures classified |
| `config` | tracked TS/TSX/JS/JSX | root | scanned; build/test lifecycle and vendored xterm patches |
| `native`, `src/cli`, `src/relay`, `src/types` | tracked source | root | scanned; targeted lifecycle search and manual review |
| docs, skills, resources, examples, scripts, packaging | non-runtime/support files | root | scanned; no production leak candidates |

## Search evidence

The audit used repository-scoped `rg --files` and targeted searches for:

- `addEventListener`, `removeEventListener`, `.on(`, `.once(`, `.off(`
- `setTimeout`, `setInterval`, `requestAnimationFrame`
- `DisposableStore`, `MutableDisposable`, `_register`, `onWillDispose`, `onDidDispose`
- React effects and cleanup returns (`useEffect`, `useFocusEffect`)
- pool/factory creation patterns and long-lived caches/maps/sets

Generated/vendor/build output (`node_modules`, `dist`, `out`, VCS metadata) was
excluded. Test fixtures that intentionally keep child processes or listeners
alive for a scenario were reviewed separately from application code.

## Findings ledger

| ID | Area/file | Finding | Action | Validation |
|---|---|---|---|---|
| ML-001 | `src/renderer/src/components/editor/combined-diff/remember-view/combined-diff-view-memory.ts` | HMR re-evaluation accumulated an anonymous global listener and retained old module closures. | Named the handler and dispose it through `import.meta.hot.dispose`. | `use-combined-diff-view-restore.test.tsx`: 3 passed; oxlint/oxfmt passed. |
| ML-003 | `src/main/window/*-request-relay.ts` | Pending IPC requests retained response listeners and timers until timeout after renderer teardown. | Unified settlement cleanup for response listeners, timers, and closed/destroyed/render-process-gone events; catch send failures. | Focused main relay tests: 5 passed; oxlint passed. |
| ML-004 | `src/renderer/src/components/activity/activity-clear-completed.ts` | Module-level pagehide listener retained old HMR module closures. | Added Vite HMR disposer. | oxlint/oxfmt passed. |
| ML-005 | `src/renderer/src/components/contextual-tours/ContextualTourOverlaySurface.tsx` | Global Escape listener survived HMR and retained stale closure behind a window guard. | Added disposer that removes the listener and resets the guard. | oxlint/oxfmt passed. |
| ML-006 | `src/renderer/src/lib/keyboard-layout/layout-base-character.ts` | HMR could duplicate the focus listener and API layout-change subscription after the module guard reset. | Added disposer removing both hooks and resetting the installation guard. | oxlint/oxfmt passed. |
| ML-007 | `src/renderer/src/lib/input-quiet-scheduler.ts` | HMR could stack global capture listeners and stale `recordInput` closures. | Added disposer removing listeners from the installed window. | oxlint/oxfmt passed. |
| ML-009 | `src/renderer/src/components/terminal-pane/terminal-render-desync-trigger.ts` | HMR could stack the opt-in mouseup listener and retain stale burst state. | Added disposer removing the listener and stopping the active burst. | oxlint/oxfmt passed. |
| ML-008 | `src/main/hang-watchdog/main-thread-hang-watchdog.ts` | Repeated watchdog lifecycles retained the app `will-quit` stop listener after manual stop/worker exit. | Remove the app listener whenever the watchdog stops. | Hang watchdog tests: 8 passed; oxlint passed. |
| ML-002 | `src/preload/preload-runtime-support.ts` | Installation functions could add duplicate global listeners if setup ran repeatedly, retaining closures and processing each drop more than once. | Added idempotent guards to native drop and browser-find listener installation. | Native chat drop scope test: 10 passed; oxlint passed. |
| ML-010 | `src/renderer/src/components/terminal-pane/terminal-parked-watcher-registry.ts` | Parked panes bypass the normal close teardown; their keyed scroll-intent records stayed in strong Maps after tab close or worktree removal. | Release captured leaf keys during parked-tab retirement and worktree pruning. | Parked-watcher reconciliation tests: 6 passed; PR #20924. |
| ML-011 | `src/renderer/src/components/terminal-pane/terminal-hidden-worktree-retention.ts`, `terminal-eviction-exempt-tabs.ts`, `src/renderer/src/lib/pane-manager/pane-manager-registry.ts` | Fail-open, foreign-worktree, and capability-unknown PTYs are intentionally exempt from force-parking, so their mounted xterm panes can retain rows × columns of scrollback indefinitely; `pane-manager-registry` estimates 16 bytes per cell. | Kept as an unresolved safety tradeoff: force-unmounting these panes can orphan a live shell. The safe fix is to make the PTY classes reattachable or add authoritative capability resolution, then bound the exemption. | Source retaining-path review; existing eviction-exempt and pane-memory census instrumentation. |
| ML-012 | `src/shared/process-table-index.ts` | A cyclic PID/parent relationship makes the descendant walk copy rows forever. A two-row cycle exhausted an isolated 32 MiB Node heap in about 0.15 seconds. | Independently verified existing open [#20715](https://github.com/stablyai/orca/pull/20715), avoiding a duplicate fix. | Exact production hunk passed cycle, self-cycle, root reuse, duplicate/shared-subtree fixtures and 500 acyclic parity cases; local evidence in `notes/process-table-cycle/`. |
| ML-013 | `src/main/stats/collector.ts` | The event cap was enforced only during serialization; stalled asynchronous persistence let the live event array grow without a bound. | Enforce the existing 10,000-event cap on append, retaining newest events and lifetime totals; [#20941](https://github.com/stablyai/orca/pull/20941). | All 24 stats tests passed, including a blocked-write regression that fails before the fix. |
| ML-014 | `src/relay/pty-shell-utils.ts` | The SSH relay has an independent descendant walker; cyclic parent links cause repeated copying/allocation there too, so fixing only ML-012 leaves the relay exposed. | Added a visited-PID guard to the existing walker; [#20946](https://github.com/stablyai/orca/pull/20946). | 42 relay foreground tests passed; cyclic regression stops after 20 reads if the guard is removed, avoiding an OOM in the test worker. |
| ML-015 | `src/main/daemon/daemon-stream-data-batcher.ts` and stream/PTY pause ownership | The 32 MiB held-queue valve transfers excess output into an unbounded socket queue when a reader stalls; small writes bypassed the held-queue valve too. | Backpressure visible producers, preserve hidden keep-tail shedding, and fence attachment handoffs; [#20947](https://github.com/stablyai/orca/pull/20947). | 163 tests in 11 suites; real paused-reader experiments demonstrate producer pause, bounded queues and complete drain. [Artifacts](./daemon-stream-retention/README.md). |
| ML-016 | `src/main/browser/cdp-client-response-writer.ts`, `cdp-debugger-channel.ts` | CDP events and responses accumulate in WebSocket buffers behind an unread client. A 128 MiB experiment retained 133,177,280 queued bytes. | Reuse the existing bounded outbound queue and terminate stalled clients on overflow, preserving single large healthy replies; [#20949](https://github.com/stablyai/orca/pull/20949). | 66 tests; real WebSocket before/after reproduction. [Artifacts](./cdp-stream-retention/README.md). |
| ML-017 | `src/shared/terminal-osc-link-retirement.ts`, headless/renderer/mobile terminal integrations | OSC 8 link entries and marker listeners survive overwritten cells. 10,000 redraws retain about 20.5–20.9 MB after GC with only 24 rows. | Collect entries unreferenced by either buffer or active attributes after registry growth; [#20955](https://github.com/stablyai/orca/pull/20955). | Real installed headless and renderer builds retain about 1.6–1.7 MB after the fix; snapshot/fidelity/pane regressions and 15 mobile tests pass. Private xterm fields and buffer-size-dependent sweep cost are explicit limitations. [Artifacts](./osc-link-retention/README.md). |
| ML-018 | CI excerpts, main/relay recent output, terminal session/eager/shutdown/reattach tails, and terminal error surfaces | Capped V8 slices pin oversized inputs. Eight 16 KiB CI excerpts retained 16–32 MiB; eight 4,000-character errors retained 32 MiB; eight terminal tails reporting 4 MiB retained 32 MiB. | Reuse the existing shared and renderer string copiers at six retention boundaries; [#20960](https://github.com/stablyai/orca/pull/20960). | Real-function after-GC measurements fall to about 0.1–0.15 MiB, 33 KiB, and 4 MiB respectively. CI/provider/content and retained state/queue tests pass. [Artifacts](./retained-text-slices/README.md). |
| ML-019 | `src/main/ai-vault/session-scanner-jsonl-reader.ts` | Incremental JSONL framing retained an entire newline-free record and then allocated concatenated/decoded copies. A 64 MiB record peaks near 248 MiB RSS despite the scanner child’s 384 MiB V8 old-space setting. | Share the existing streamed remote 10 MiB record budget and reject before retaining/concatenating/decoding oversized records; [#20963](https://github.com/stablyai/orca/pull/20963). | Real-file reproduction peaks near 62 MiB RSS and stops at 10 MiB plus one input chunk; 71 reader/cache/WSL tests and ten reader/recovery tests pass (nine overlap). Valid larger records now produce a session scan issue; whole-document readers are outside this fix. [Artifacts](./transcript-record-retention/README.md). |
| ML-020 | Vendored xterm WebGL `TextureAtlas` | Invisible glyph variants occupied no texture pixels but each added cache metadata, so page eviction never bounded them. 100,000 colored-space redraws retained 100,093 entries and about 13.5–13.7 MB of V8 heap growth on one texture page. | Separate invisible caches with a shared 4,096-entry cap, preserving visible glyphs and pages; regenerated CJS/ESM/source maps and lockfile hashes in [#20965](https://github.com/stablyai/orca/pull/20965). | Actual installed CJS and ESM bundles retain 1,789 entries and about 0.2–0.4 MB heap growth; shared-terminal pixel hashes, cache hits, empty-only clear, 86 tests, and pinned regeneration checks pass. [Artifacts](./webgl-empty-glyph-retention/README.md). |

## GitHub memory-issue correlation

The source scan was compared with the open reports returned by GitHub search. The
following distinctions matter for #19831: a renderer or browser cache leak is not
the same as resident child processes, and a child workload OOM is not evidence of
an Orca heap leak.

The [issue-search index](./memory-issue-index-2026-09-15.json) records all 58 open
title matches for `memory`, `oom`, `leak`, `orphan`, `RAM`, and `growth`, with
explicit exclusions for unrelated uses of those words. Every title search returned
fewer than its 100-result cap. A batched recheck found 57 still-open title matches,
no new matches, and #9141 closed; all six `hasNextPage` flags were false. Broader
body searches supplied additional reports.

| Issue | Current-code explanation |
|---|---|
| [#19831](https://github.com/stablyai/orca/issues/19831) | **Code mechanisms reproduced; incident attribution remains unproven.** ML-017 can grow main/daemon/renderer heaps during local hyperlink redraws even with fixed pane and row counts. ML-015 reproduces unbounded daemon buffering behind a stalled reader. The local eviction exemption and failed PTY teardown can retain mounted buffers or child processes. Existing [#16963](https://github.com/stablyai/orca/pull/16963) covers Linux descriptor/shared-memory inheritance into detached daemons. ML-012 can cause a late sharp allocation ramp; ML-016 requires a stalled CDP client. ML-018 reproduces parent-string retention after CI-log viewing or oversized terminal payloads despite small logical caps. ML-019 adds unbounded external allocation while a scanner child assembles an oversized transcript record. ML-020 adds renderer cache growth from distinct invisible glyph/color variants. The report establishes none of those specific triggers. Its 16.2 GB memory and 15.2 GB swap peaks are separate maxima, not a contemporaneous 31.4 GB allocation; the later kill was roughly 4h42m after the first and about three minutes into its own launch. No affected-host data is available. Small listener/scroll-intent fixes cannot explain the reported scale. |
| [#19768](https://github.com/stablyai/orca/issues/19768) | **PTY accumulation explained; main-process incident not attributed.** Readiness failure enters `tearDownFailedWorkerStart`, which leaves the created PTY for manual `worker-release`; repeated respawns retain terminals/process trees. That does not explain the separately measured main PID. ML-017 supplies a reproduced main-mirror retaining path, and the cyclic process walk in ML-012 runs during foreground polling after dispatches stop. ML-018 adds retained CI/terminal backing strings. Neither the necessary hyperlink/oversized-input traffic nor a cyclic field process table is established. ML-019 normally runs in a scanner child and ML-020 is renderer-only, so neither explains the separately measured main PID. Main renderer-delivery data has ACK/backlog caps, and synchronous headless parsing rules out an indefinite parser stall in the tested build. |
| [#19193](https://github.com/stablyai/orca/issues/19193) | **Explained by an unbounded retention policy.** A reuse miss launches a fresh session and immediately releases ownership so the old session remains protected. There is no cap on protected reuse seeds when the status gate keeps missing; 101 misses can therefore leave 101 live terminals. |
| [#9479](https://github.com/stablyai/orca/issues/9479), [#13047](https://github.com/stablyai/orca/issues/13047) | **Explained for headless/legacy paths.** Headless one-shot automation returns after output/settlement without closing its launched terminal. Legacy `legacy_ambiguous` worker rows are intentionally retained and require `worker-release`; they have no automatic reaper. |
| [#18789](https://github.com/stablyai/orca/issues/18789) | **Explained by a durable-handle/volatile-table gap.** Worker release/stop can report `release_unknown` or `terminal_handle_stale` after a renderer epoch change and skip `runtime.closeTerminal`, leaving the PTY in the host cgroup. |
| [#19018](https://github.com/stablyai/orca/issues/19018), [#15210](https://github.com/stablyai/orca/issues/15210) | **Explained as a local teardown gap.** Local shutdown keeps provider state until physical exit is observed; timeout/missing exit leaves the PTY indexed. The close provider logs failed local kills but has no durable retry equivalent to the SSH path. |
| [#19116](https://github.com/stablyai/orca/issues/19116) | **Explained as a browser resource policy gap.** `OffscreenBrowserBackend` owns one hidden `BrowserWindow` per page until explicit close and guest policy disables background throttling for every guest. Existing 256-page command/placement caps do not cap these windows or GPU surface memory. |
| [#12728](https://github.com/stablyai/orca/issues/12728) | **Partially explained.** Open PR [#16870](https://github.com/stablyai/orca/pull/16870) closes one Darwin node-pty `kqueue` descriptor per PTY lifecycle. The report's Windows orphan child processes and allocator high-water behavior remain separate. |
| [#9138](https://github.com/stablyai/orca/issues/9138), [#11342](https://github.com/stablyai/orca/issues/11342) | **Partially explained.** Live old-protocol daemons are intentionally preserved for adoption, while pre-v24 generations have no atomic idle-shutdown RPC. A startup `listSessions`→`shutdown` fallback was rejected in this audit because it can race a new PTY and kill live work. |
| [#17344](https://github.com/stablyai/orca/issues/17344) | **Local tombstone exclusion confirmed; resurrection cause unresolved.** Non-local user-close tombstones feed the SSH pull merge; local close already removes tabs/layouts and writes whole maps. Current host retirement removes exact incarnation bindings, and legacy host tombstones are drained. `rebaseIncarnationBindings` only prunes when membership actually rebases, leaving a conditional stale-metadata gap on other paths; this alone neither recreates tabs nor explains gigabytes. Unconditionally merging prior bindings would risk replacing a newly created incarnation. |
| [#16714](https://github.com/stablyai/orca/issues/16714) | **Explained by agent classification.** Descendant sweeping is gated on `session.launchAgent`; a hand-typed Claude/Codex process in a plain shell can outlive the shell and escape ownership. |
| [#19187](https://github.com/stablyai/orca/issues/19187), [#19316](https://github.com/stablyai/orca/issues/19316) | **Explained by platform cleanup gaps.** Windows profiles containing spaces take the encoded launcher/conhost path; WSL timeout paths omit the `terminationBarrier`, so only the root process is stopped. Existing open [#19319](https://github.com/stablyai/orca/pull/19319) covers the WSL runner/environment probe and [#19341](https://github.com/stablyai/orca/pull/19341) covers the execFile probes; this audit does not duplicate those fixes. |
| [#13753](https://github.com/stablyai/orca/issues/13753), [#8652](https://github.com/stablyai/orca/issues/8652) | **Reported classes addressed in current source.** Live transcript readers use bounded tail/incremental parsing; the older full-reader cache has no production caller in the current source. Readiness polling is bounded. SSH hidden PTY parking was fixed by [#10625](https://github.com/stablyai/orca/pull/10625). This does not retest the original affected hosts. |
| [#15241](https://github.com/stablyai/orca/issues/15241) | **Logical error limits existed; backing storage still retained oversized messages.** The eight-entry, 4,000-character/24-line caps did not detach V8 parent strings. ML-018 reproduces 32 MiB retained by eight error strings totaling only 32,000 characters and reduces it to about 33 KiB. [#20960](https://github.com/stablyai/orca/pull/20960) fixes that remaining error-retention gap without changing displayed text. |
| [#7783](https://github.com/stablyai/orca/issues/7783), [#9530](https://github.com/stablyai/orca/issues/9530), [#9141](https://github.com/stablyai/orca/issues/9141) | **Historical or policy-dependent process retention.** #7783 is the intentional detached-daemon/remote-PTY survival policy; #9530 can still occur through unrecognized or failed local ownership teardown; #9141's one-helper-per-click behavior is not present in current singleton computer-use providers. |
| [#14549](https://github.com/stablyai/orca/issues/14549), [#18839](https://github.com/stablyai/orca/issues/18839), [#19828](https://github.com/stablyai/orca/issues/19828), [#16630](https://github.com/stablyai/orca/issues/16630), [#12588](https://github.com/stablyai/orca/issues/12588), [#10928](https://github.com/stablyai/orca/issues/10928) | **Not an identified Orca heap leak.** These describe external child V8/GPU workloads, system pressure, missing host resource boundaries, or insufficient diagnostics. The live native-chat tail/incremental readers have record limits. The separate AI Vault incremental reader lacked one (ML-019, now fixed by #20963); whole-document/import readers still have distinct allocation behavior. No issue-specific oversized record is established, and there is no memory-aware aggregate fleet limit or main-process memory breadcrumb. |
| [#8362](https://github.com/stablyai/orca/issues/8362) | **Fixed in current source.** The node-pty master close-on-exec patch is in `config/patches/node-pty@1.1.0.patch`; relay deployment ships and applies the companion patch asset. Both [#17914](https://github.com/stablyai/orca/pull/17914) and [#17920](https://github.com/stablyai/orca/pull/17920) are merged. Old live relays still retain their old binary until replaced. |
| [#13764](https://github.com/stablyai/orca/issues/13764) | **Unresolved macOS login-wrapper retention with an existing fix under review.** Current subprocess teardown sends signals but has no childless `/usr/bin/login` reaper. [#13973](https://github.com/stablyai/orca/pull/13973) remains open; its hardware reproduction is unverified. This is not a Linux explanation for #19831. |
| [#12662](https://github.com/stablyai/orca/issues/12662), [#11904](https://github.com/stablyai/orca/issues/11904) | **Kill-delivery gaps remain.** Unexpected legacy attach spawns now fail with `TerminalSessionOwnerUnverifiedError` when retirement fails, preserving uncertainty, but `daemon-attach-only-retirement.ts` has no durable retry. `terminal-tab-close-providers.ts` still removes UI ownership and only logs failed runtime/local closes; SSH's durable pending-kill replay does not cover those routes. |
| [#11943](https://github.com/stablyai/orca/issues/11943), [#12931](https://github.com/stablyai/orca/issues/12931) | **Bounded transport queues with unresolved reconnect behavior, not a demonstrated heap leak.** `dispatcher-notification-publication.ts` still puts replay on the fatal-on-overflow control lane; ordinary producer oversize is now dropped without closing. The watcher event queue is bounded, and grace time zero deliberately preserves live PTYs. Source review does not establish that the canary exit caused the reported reconnect loop. |
| [#15909](https://github.com/stablyai/orca/issues/15909) | **Creation path addressed in current source.** Runtime background terminal creation now always passes `persistHostSessionBinding: true`; `cli-terminal-create-host-session-binding.test.ts` covers the unfocused path. Recovery of pre-existing unbound live panes is a separate issue. |
| [#8613](https://github.com/stablyai/orca/issues/8613) | **Removal ordering addressed; detached descendants remain a separate risk.** Registered local removal now calls `stopPtysForDestructiveWorktreeRemoval` with `requirePhysicalStop: true` before deleting files and purges metadata after success; generic deletion failure preserves retry metadata. Processes that escape the PTY ownership tree still require the descendant-ownership work tracked elsewhere. |
| [#17298](https://github.com/stablyai/orca/issues/17298) | **Logging half fixed; graceful stop remains a signal request.** `daemon-request-router.ts` now records `errorName` and error text. Non-immediate teardown still returns before physical exit by design; immediate/destructive teardown waits for exit. A success event alone cannot be used as proof that memory was released. |
| [#19953](https://github.com/stablyai/orca/issues/19953) | **Confirmed Windows discovery gap.** `sweepSupersededRelayEndpoints` returns before probing or logging on Windows. Live superseded relay generations can remain unknown to the client; enumeration alone would not authorize killing them. |
| [#19388](https://github.com/stablyai/orca/issues/19388) | **Missing automatic release policy, not proven JS heap retention.** Reconciliation handles only requested/releasing resources; reclaimable workers require explicit per-dispatch release. These are SQLite rows, and the report says releasing over 155 did not materially reduce memory (`processAction: none`). |
| [#18803](https://github.com/stablyai/orca/issues/18803), [#18737](https://github.com/stablyai/orca/issues/18737), [#19166](https://github.com/stablyai/orca/issues/19166) | **Stale-handle/uncertain-release family.** Federation observes a stale handle as missing and returns `stop_unknown` without closing. Explicit local release can move missing workers to `release_unknown`; only recovery mode probes process liveness, and unknown intents are excluded from its backlog. Current host-scope persistence is sufficient to avoid a new attachment schema, but safely re-identifying a process and reconciling missing archives require more than unconditional cleanup. |
| [#15987](https://github.com/stablyai/orca/issues/15987) | **Fixed by streamed upload staging.** Current staging records stat identity and sends sequential 384 KiB chunks; [#16106](https://github.com/stablyai/orca/pull/16106) replaced whole-file buffering. |
| [#16905](https://github.com/stablyai/orca/issues/16905), [#19522](https://github.com/stablyai/orca/issues/19522), [#17033](https://github.com/stablyai/orca/issues/17033) | **Partially addressed native-resource work.** Relocated Windows daemons still omit the native process-tree package and fall back to repeated PowerShell table reads. Open [#17115](https://github.com/stablyai/orca/pull/17115) covers that packaging/polling path. The cited quick-open directory handle now closes in `finally`; recurring interpreter spawning is not by itself proof of a retained heap. |
| [#15146](https://github.com/stablyai/orca/issues/15146), [#17276](https://github.com/stablyai/orca/issues/17276) | **Detached-descendant ownership gap.** Memory attribution and termination snapshots walk current parent IDs from registered PTY roots. A real tmux server or tool child that has already detached/reparented escapes that graph; Orca-managed native-pane shims mitigate only the launch paths they own. This explains invisible resident processes, not Electron heap growth. |
| [#10493](https://github.com/stablyai/orca/issues/10493), [#16084](https://github.com/stablyai/orca/issues/16084) | **Aggregate resource boundary/recovery gap.** Session creation has no fleet memory admission gate, and the coordinator's four-worker default does not cover all terminal or agent-hook spawns. Host OOM/panic causality requires the reported process/cgroup evidence; source confirms the absent boundary, not the precise incident trigger. |
| [#12243](https://github.com/stablyai/orca/issues/12243) | **Daemon discovery is incomplete by design.** Legacy discovery enumerates protocol endpoints within the current profile's runtime directory. Lost-artifact/other-profile detached daemons remain undiscovered; PPID 1 is expected for normal surviving daemons and is not sufficient evidence to kill them. |
| [#9819](https://github.com/stablyai/orca/issues/9819), [#16275](https://github.com/stablyai/orca/issues/16275) | **Current cleanup paths address the reported classes.** SSH replays durable pending kills and reconciles orphan PTYs against execution-host evidence. Windows node-pty teardown now closes ConPTY and uses owned jobs for descendants. These fixes do not establish that every still-open historical report has been retested on its affected host. |
| [#17293](https://github.com/stablyai/orca/issues/17293) | **Provider resource leak, not app heap retention.** Cleanup resolves the runtime's repository before loading/invoking the destroy recipe; an unresolvable repository can prevent provider destruction and retain a provisioned VM. A safe fix needs durable recipe/cwd authority after repo removal. |
| [#7175](https://github.com/stablyai/orca/issues/7175), [#11218](https://github.com/stablyai/orca/issues/11218) | **Insufficient incident attribution.** Current terminal delivery bounds backlog, write size and per-drain work, addressing the old saturation hypothesis. Resource Manager now claims each PID once, so overlapping display rows do not prove double-counted allocation. Neither source fact identifies the precise freeze or 135 GB incident. |
| [#10358](https://github.com/stablyai/orca/issues/10358), [#15549](https://github.com/stablyai/orca/issues/15549) | **Publication/registry gaps with limited memory evidence.** The creation error is a ten-second wait for graph/handle publication after allocation; that wait has no rollback. Provider inventory is map-based and missing physical-exit callbacks can retain phantom ownership after the OS process is gone. Current ConPTY cleanup is stronger, but the original surviving-host report has not been reproduced here. |
| [#19724](https://github.com/stablyai/orca/issues/19724) | **Conditional WSL cleanup gap.** Relay creation is single-flight per distro, but timeout/teardown issues an unawaited `child.kill()` and drops its reference before retry; the generic WSL runner lacks a termination barrier. Surviving child/handle accumulation is plausible, but the exact `WSAENOBUFS` trigger requires a host trace. |

The independently reproduced PID-cycle defect (ML-012) can execute in the daemon
or in Electron main for fallback local PTYs. Foreground inspection continues for
live panes after dispatches stop, making it relevant to #19768's later episode.
It causes synchronous allocation and an event-loop freeze. #19831's journal
endpoint peaks cannot distinguish a late sharp ramp from sustained gradual
accumulation. No actual cyclic process table from #19831/#19768 was captured, so
neither incident is attributed to it as a proven root cause.

The relay sibling is separately fixed by ML-014. A suspicious Windows ancestry
loop is not a second independent defect after #20715: its input is the guarded
walk's acyclic projection. No redundant defensive patch was added there.

Main's headless terminal `writeChain` also retains raw chunks behind a pending
write (an injected stall held 32.07 MiB and released it on drain), but the installed
xterm parser is synchronous and renderer hydration has a 750 ms timeout. This
demonstrates temporary buffering, not a credible indefinite stall explaining
#19768. Memory snapshots/process polling coalesce in-flight work; normal exit
disposes each main-process terminal model, whose scrollback is capped at 5,000 rows.

The daemon socket path was reproduced against the pre-fix source with a real
paused loopback TCP reader. After 96 MiB of output, the held queue stayed near
32 MiB while Node's socket retained another 66.4 MB; each further input byte
retained approximately one more byte. Resuming the reader drained both queues.
The 32 MiB write-through valve therefore transferred backlog into the socket
rather than bounding memory. The producer-backpressure fix is published as [#20947](https://github.com/stablyai/orca/pull/20947).
Visible producers pause within the queue budget; hidden output keeps its existing
shedding policy. Small writes and exclusive-attachment handoffs are covered. All
real-socket cases resume and drain to zero; [measurements and reproduction](./daemon-stream-retention/README.md)
are tracked with the fix. Native producers that cannot pause remain best-effort.

The renderer retention path is similarly deliberate rather than an accidental
listener leak. `isEvictionExemptTerminalPty` treats a missing session separator,
foreign worktree id, or unknown snapshot capability as unrestorable; the tab
therefore stays mounted so force-parking cannot orphan its shell. The comments
and memory census quantify the cost (rows × columns, roughly 16 bytes per cell),
but there is no safe finite cap while those PTYs cannot be reattached. This is a
local-only resource-pressure candidate for #19831. It requires enough retained
panes and populated scrollback; it does not establish growth in a fixed pane set.

The ledger is updated as each agent returns a concrete finding or a verified
no-finding result. A fix gets its own commit so it can be proposed as a separate
PR.

## Runtime debugging availability

### Reported-version check

Targeted reads of tag `v1.4.198` (release commit
`e0826956fcfc532f5a1e55b5e081f2e57e553c43`, 2026-09-08) confirmed that the
eviction exemptions, daemon write-through/small-write paths, serialization-only
stats cap, both unguarded process walkers, and the affected xterm package versions
already existed in the reported build. The six capped-string retention boundaries
in ML-018 also exist in that tag. The unbounded AI Vault reader and its scanner
child’s 384 MiB old-space setting in ML-019 are present too; the newer per-record
copy optimization did not add a record limit. The WebGL addon version in ML-020
also matches that tag, whose source patch lacked an invisible-entry cap. Main headless models already had 5,000-row scrollback, synchronous parsing,
the 750 ms renderer timeout, and normal-exit disposal. Later stream scan/encoding
optimizations did not fix the retention mechanism. The historical agent-row store
removed by [#19785](https://github.com/stablyai/orca/pull/19785) held one bounded
status payload per pane and cleared on PTY teardown. It retained stale dismissed
rows, but 100,000 updates to one pane retained one row; the memory-only store did
not survive restart. Neither report establishes enough distinct pane churn for
that store to explain gigabytes.

### Additional correlations and rejected duplicates

- Existing [#16963](https://github.com/stablyai/orca/pull/16963) reports Linux/Windows
  Chromium descriptor inheritance through the detached daemon launcher. The direct
  `fork()` remains in `daemon-launched-child.ts` and in `v1.4.198`. Its published
  reproduction includes deleted shared-memory files and lingering crashpad resources.
  This audit confirmed the source route but did not reproduce Linux descriptor counts
  or memory bytes on this macOS host; no duplicate launch-policy patch was made.
- The boundary flattening, residual-slice flattening, and consumed-slot clearing
  proposed in [#13040](https://github.com/stablyai/orca/pull/13040) already exist in
  current split renderer queue modules and `v1.4.198`. An open historical PR is not
  evidence that its mechanism remains unfixed in the reported release.
- The real xterm OSC 8 reproduction (ML-017) is independent of row-count caps.
  Current upstream pi emits anonymous OSC 8 links when its capability check enables
  hyperlinks, but its default detector does not recognize `TERM_PROGRAM=Orca`;
  overrides or inherited terminal hints can change that. Orca sets that terminal
  name in local and relay spawns. The report's mention of pi alone is therefore
  not evidence that it supplied this traffic. See upstream
  [capability detection and hyperlink writer](https://github.com/badlogic/pi-mono/blob/main/packages/tui/src/terminal-image.ts)
  and [Markdown rendering](https://github.com/badlogic/pi-mono/blob/main/packages/tui/src/components/markdown.ts),
  inspected on the audit date rather than as a claim about the reporter's pi version.
  Native-chat cache code, ordinary bounded browser logs, and temporary headless
  `writeChain` buffering did not yield another demonstrated indefinite growth path.
- The renderer queue fix from #13040 does not cover the CI excerpt, persisted
  session tail, eager/shutdown buffer, deferred reattach queue, or terminal error
  surface or main/relay recent-output buffer. ML-018 adds copying at those independently reproduced boundaries.
- Structured-chat journals keep a reducer projection of the readable conversation.
  Provider eviction closes/removes owned journals; readable childless restores can
  remain indexed without a release timer. That is a separate history/cache policy
  concern, not evidence for the terminal-only incidents. Blindly invoking full
  session close is unsafe because it may close a retained TUI owner.
- The installed terminal parser caps OSC/DCS payloads, title stacks, and Kitty
  keyboard stacks. Its per-cell combined-character and extended-attribute tables
  are keyed by buffer position; this review did not identify a second ordinary
  redraw leak there. WebGL’s empty-glyph cache was then independently reproduced
  with actual rendered terminal output (ML-020) and fixed in #20965. One hundred
  thousand unique colored-space variants add metadata without filling even one
  texture page; a shared invisible-entry cap now bounds that cache. Both generated
  module formats preserve sibling terminals’ rendered pixels and ordinary cache
  hits. This is a separate renderer path, not a main-PID explanation.
- The AI Vault child’s V8 heap setting does not bound external Buffer storage.
  Its local JSONL reader now shares the streamed remote record cap (ML-019).
  Mainline scanning surfaces oversized records as a per-session issue, preserves
  the previous cached resume point, and succeeds after a repaired append.
  Whole-document parsers and legacy imports remain outside this particular fix.

### Available evidence

No Chrome DevTools heap snapshot or memory-debugging MCP tools were available
in this session. This pass used source retaining-path analysis, lifecycle tests,
and isolated Node experiments measuring retained socket bytes, RSS, and bounded
heap exhaustion. It does not claim an affected-host heap slope or a field
heap-snapshot comparison. No raw heap snapshots were read; the user confirmed
that affected-host data is unavailable.

## Pull requests

- [#20903 — terminal editor close timers](https://github.com/stablyai/orca/pull/20903)
- [#20904 — deferred diff model disposal](https://github.com/stablyai/orca/pull/20904)
- [#20905 — signout auth retry](https://github.com/stablyai/orca/pull/20905)
- [#20906 — copied prompt reset](https://github.com/stablyai/orca/pull/20906)
- [#20908 — renderer HMR listener teardown](https://github.com/stablyai/orca/pull/20908)
- [#20909 — renderer relay/preload listener cleanup](https://github.com/stablyai/orca/pull/20909)
- [#20910 — hang watchdog quit listener](https://github.com/stablyai/orca/pull/20910)
- [#20924 — parked terminal scroll-intent cleanup](https://github.com/stablyai/orca/pull/20924)
- [#20941 — stats retention during stalled persistence](https://github.com/stablyai/orca/pull/20941)
- [#20946 — relay process-cycle allocation guard](https://github.com/stablyai/orca/pull/20946)
- [#20947 — daemon stream producer backpressure](https://github.com/stablyai/orca/pull/20947)
- [#20949 — CDP socket backlog cap](https://github.com/stablyai/orca/pull/20949)
- [#20955 — terminal hyperlink metadata retirement](https://github.com/stablyai/orca/pull/20955)
- [#20960 — retained CI and terminal string tails](https://github.com/stablyai/orca/pull/20960)
- [#20963 — AI Vault transcript record allocation cap](https://github.com/stablyai/orca/pull/20963)
- [#20965 — invisible WebGL glyph cache cap](https://github.com/stablyai/orca/pull/20965)

Validation: the initial lifecycle pass ran 27 focused tests. Subsequent fixes ran
24 stats tests, 42 relay foreground tests, 163 daemon stream tests, and 66 CDP tests.
Hyperlink verification covered emulator/snapshot/fidelity/pane suites, a final
62-test desktop run, and 15 mobile engine/init tests. Retained-string validation
ran 41 CI/provider/helper tests, 69 terminal-buffer tests, and a further 28
error/reattach/retained-heap tests. A final seven-suite run passed 63 tests
covering the main/relay buffer and existing shared copier. Transcript validation
ran 71 reader/remote/cache/WSL tests and ten reader/recovery tests (nine overlap).
WebGL cache validation adds 86 tests and six headless Chromium runs of 100,000
redraws each, including both installed bundle formats. These are per-run counts,
not a sum of unique tests. Full `pnpm tc`, mobile typecheck, oxlint/formatting and
the changed-code quality gate passed. Mobile's pre-existing frozen-lock/patch
configuration mismatch required dependency setup with the original lockfile
preserved. Every test/app command used `ORCA_BACKGROUND_LAUNCH=1`; no application
window was opened.

The first daemon-idle cleanup proposal (#20925) was closed and reverted after a
race review showed that pre-v24 `listSessions` followed by `shutdown` could kill
new live work. It is not counted among the 16 published fixes. Fan-out was used
for the initial audit and issue passes; later follow-up agents hit the service
usage limit, so the later hyperlink, retained-string, transcript, and WebGL work was reviewed and validated locally.
