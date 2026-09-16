# Memory leak audit coverage (2026-09-15)

This ledger records the full repository scan for the `memory-leak-audit` and
`memory-leak-debugging` skills. Source ownership was split across agents, but
all edits are made in this worktree and every area below is accounted for.

## Coverage

| Area | Files scanned | Audit owner | Status |
|---|---:|---|---|
| `src/renderer` | tracked TS/TSX/JS/JSX | renderer agent | complete; HMR and parked-tab lifecycle fixes |
| `src/main` | tracked TS/TSX/JS/JSX | main agent | complete; relay teardown fix |
| `src/preload` + `src/shared` | tracked TS/TSX/JS/JSX | preload/shared agent | complete; one low-risk fix |
| `mobile` | tracked TS/TSX/JS/JSX | root | complete; no valuable leaks found |
| `cloud` | tracked TS/TSX/JS/JSX | root | complete; no valuable leaks found |
| `tests` | tracked TS/TSX/JS/JSX | root + area owners | complete; fixtures classified |
| `config` | tracked TS/TSX/JS/JSX | root | complete; build/test lifecycle only |
| `native`, `src/cli`, `src/relay`, `src/types` | tracked source | root | complete; targeted lifecycle search and manual review |
| docs, skills, resources, examples, scripts, packaging | non-runtime/support files | root | complete; no production leak candidates |

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
| ML-010 | `src/renderer/src/components/terminal-pane/terminal-parked-watcher-registry.ts` | Parked panes bypass the normal close teardown; their keyed scroll-intent records stayed in strong Maps after tab close or worktree removal. | Release captured leaf keys during parked-tab retirement and worktree pruning. | Parked-watcher reconciliation tests: 7 passed; PR #20924. |

## GitHub memory-issue correlation

The source scan was compared with the open reports returned by GitHub search. The
following distinctions matter for #19831: a renderer or browser cache leak is not
the same as resident child processes, and a child workload OOM is not evidence of
an Orca heap leak.

| Issue | Current-code explanation |
|---|---|
| [#19831](https://github.com/stablyai/orca/issues/19831) | **Partially explained, no single root proven.** Local-only scope rules out the SSH parking report. Candidate contributors are retained PTY/process trees, unbounded one-shot/headless automation terminals, protected `reuseSession` terminals, and the daemon stream write-through path when a renderer stops reading. The small parked scroll-intent leak is real but cannot account for gigabytes. The report's second post-relaunch growth episode still needs a main-process heap/profile capture. |
| [#19768](https://github.com/stablyai/orca/issues/19768) | **First burst explained by lifecycle policy.** `startLocalWorker` creates a terminal, readiness failure enters `tearDownFailedWorkerStart`, and that function deliberately leaves the created PTY for a later manual `worker-release`. Repeated readiness respawns therefore retain one terminal/process tree per attempt. The later 17 GB growth with no active dispatch is not explained by this path. |
| [#19193](https://github.com/stablyai/orca/issues/19193) | **Explained by an unbounded retention policy.** A reuse miss launches a fresh session and immediately releases ownership so the old session remains protected. There is no cap on protected reuse seeds when the status gate keeps missing; 101 misses can therefore leave 101 live terminals. |
| [#9479](https://github.com/stablyai/orca/issues/9479), [#13047](https://github.com/stablyai/orca/issues/13047) | **Explained for headless/legacy paths.** Headless one-shot automation returns after output/settlement without closing its launched terminal. Legacy `legacy_ambiguous` worker rows are intentionally retained and require `worker-release`; they have no automatic reaper. |
| [#18789](https://github.com/stablyai/orca/issues/18789) | **Explained by a durable-handle/volatile-table gap.** Worker release/stop can report `release_unknown` or `terminal_handle_stale` after a renderer epoch change and skip `runtime.closeTerminal`, leaving the PTY in the host cgroup. |
| [#19018](https://github.com/stablyai/orca/issues/19018), [#15210](https://github.com/stablyai/orca/issues/15210) | **Explained as a local teardown gap.** Local shutdown keeps provider state until physical exit is observed; timeout/missing exit leaves the PTY indexed. The close provider logs failed local kills but has no durable retry equivalent to the SSH path. |
| [#19116](https://github.com/stablyai/orca/issues/19116) | **Explained as a browser resource policy gap.** `OffscreenBrowserBackend` owns one hidden `BrowserWindow` per page until explicit close and guest policy disables background throttling for every guest. Existing 256-page command/placement caps do not cap these windows or GPU surface memory. |
| [#12728](https://github.com/stablyai/orca/issues/12728) | **Partially explained.** Open PR [#16870](https://github.com/stablyai/orca/pull/16870) closes one Darwin node-pty `kqueue` descriptor per PTY lifecycle. The report's Windows orphan child processes and allocator high-water behavior remain separate. |
| [#9138](https://github.com/stablyai/orca/issues/9138), [#11342](https://github.com/stablyai/orca/issues/11342) | **Partially explained.** Live old-protocol daemons are intentionally preserved for adoption, while pre-v24 generations have no atomic idle-shutdown RPC. A startup `listSessions`→`shutdown` fallback was rejected in this audit because it can race a new PTY and kill live work. |
| [#17344](https://github.com/stablyai/orca/issues/17344) | **Explained by the local close-tombstone gate.** User-close tombstones are recorded only for non-local worktrees, so local persisted tabs can be resurrected after hydration. |
| [#16714](https://github.com/stablyai/orca/issues/16714) | **Explained by agent classification.** Descendant sweeping is gated on `session.launchAgent`; a hand-typed Claude/Codex process in a plain shell can outlive the shell and escape ownership. |
| [#19187](https://github.com/stablyai/orca/issues/19187), [#19316](https://github.com/stablyai/orca/issues/19316) | **Explained by platform cleanup gaps.** Windows profiles containing spaces take the encoded launcher/conhost path; WSL timeout paths omit the `terminationBarrier`, so only the root process is stopped. |
| [#13753](https://github.com/stablyai/orca/issues/13753), [#15241](https://github.com/stablyai/orca/issues/15241), [#8652](https://github.com/stablyai/orca/issues/8652) | **Already addressed or closed.** Transcript parsing now uses the mtime/size cache (commit `39330c5aca`); terminal error strings and readiness polling are bounded in current code. SSH hidden PTY parking was fixed by [#10625](https://github.com/stablyai/orca/pull/10625). |
| [#7783](https://github.com/stablyai/orca/issues/7783), [#9530](https://github.com/stablyai/orca/issues/9530), [#9141](https://github.com/stablyai/orca/issues/9141) | **Historical or policy-dependent process retention.** #7783 is the intentional detached-daemon/remote-PTY survival policy; #9530 can still occur through unrecognized or failed local ownership teardown; #9141's one-helper-per-click behavior is not present in current singleton computer-use providers. |
| [#14549](https://github.com/stablyai/orca/issues/14549), [#18839](https://github.com/stablyai/orca/issues/18839), [#19828](https://github.com/stablyai/orca/issues/19828), [#16630](https://github.com/stablyai/orca/issues/16630), [#12588](https://github.com/stablyai/orca/issues/12588), [#10928](https://github.com/stablyai/orca/issues/10928) | **Not an identified Orca heap leak.** These describe external child V8/GPU workloads, system pressure, missing host resource boundaries, or insufficient diagnostics. Current archive and transcript readers are bounded, but there is no memory-aware aggregate fleet limit or main-process memory breadcrumb. |

One additional high-risk path remains without a patch in this pass:
`DaemonStreamDataBatcher` intentionally writes through after 32 MiB of held
output, but `DaemonServer` does not provide its declared `onAfterSocketWrite`
backlog-pacer callback. If a renderer stops reading while a local PTY emits
continuously, Node's socket writable buffer can grow outside the batcher's queue.
This is a strong candidate for the large-output portions of #19831/#18839 and
needs a protocol-preserving backpressure/drop design rather than a guessed cap.

The ledger is updated as each agent returns a concrete finding or a verified
no-finding result. A fix gets its own commit so it can be proposed as a separate
PR.

## Runtime debugging availability

No Chrome DevTools heap snapshot or memory-debugging MCP tools were available
in this session. This pass therefore used source retaining-path analysis and
listener/timer lifecycle regression tests; it does not claim a measured heap
slope or a heap-snapshot comparison. No raw heap snapshots were read.

## Pull requests

- [#20903 — terminal editor close timers](https://github.com/stablyai/orca/pull/20903)
- [#20904 — deferred diff model disposal](https://github.com/stablyai/orca/pull/20904)
- [#20905 — signout auth retry](https://github.com/stablyai/orca/pull/20905)
- [#20906 — copied prompt reset](https://github.com/stablyai/orca/pull/20906)
- [#20908 — renderer HMR listener teardown](https://github.com/stablyai/orca/pull/20908)
- [#20909 — renderer relay/preload listener cleanup](https://github.com/stablyai/orca/pull/20909)
- [#20910 — hang watchdog quit listener](https://github.com/stablyai/orca/pull/20910)
- [#20924 — parked terminal scroll-intent cleanup](https://github.com/stablyai/orca/pull/20924)

Validation on the combined audit branch: 26 focused tests passed, `pnpm tc`
passed, and `pnpm run check:code-quality:changed` passed.
