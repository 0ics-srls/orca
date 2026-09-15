# Memory leak audit coverage (2026-09-15)

This ledger records the full repository scan for the `memory-leak-audit` and
`memory-leak-debugging` skills. Source ownership was split across agents, but
all edits are made in this worktree and every area below is accounted for.

## Coverage

| Area | Files scanned | Audit owner | Status |
|---|---:|---|---|
| `src/renderer` | tracked TS/TSX/JS/JSX | renderer agent | complete; one HMR listener fix |
| `src/main` | tracked TS/TSX/JS/JSX | main agent | complete; relay teardown fix |
| `src/preload` + `src/shared` | tracked TS/TSX/JS/JSX | preload/shared agent | complete; one low-risk fix |
| `mobile` | tracked TS/TSX/JS/JSX | root | complete; no valuable leaks found |
| `cloud` | tracked TS/TSX/JS/JSX | root | complete; no valuable leaks found |
| `tests` | tracked TS/TSX/JS/JSX | root + area owners | complete; fixtures classified |
| `config` | tracked TS/TSX/JS/JSX | root | complete; build/test lifecycle only |
| `native`, `src/cli`, `src/relay`, `src/types` | tracked source | root | reviewed by targeted search |
| docs, skills, resources, examples, scripts, packaging | non-runtime/support files | root | reviewed; no production leak candidates |

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
| ML-005 | `src/renderer/src/components/ContextualTourOverlaySurface.tsx` | Global Escape listener survived HMR and retained stale closure behind a window guard. | Added disposer that removes the listener and resets the guard. | oxlint/oxfmt passed. |
| ML-006 | `src/renderer/src/lib/keyboard-layout/layout-base-character.ts` | HMR could duplicate the focus listener and API layout-change subscription after the module guard reset. | Added disposer removing both hooks and resetting the installation guard. | oxlint/oxfmt passed. |
| ML-007 | `src/renderer/src/lib/input-quiet-scheduler.ts` | HMR could stack global capture listeners and stale `recordInput` closures. | Added disposer removing listeners from the installed window. | oxlint/oxfmt passed. |
| ML-008 | `src/main/hang-watchdog/main-thread-hang-watchdog.ts` | Repeated watchdog lifecycles retained the app `will-quit` stop listener after manual stop/worker exit. | Remove the app listener whenever the watchdog stops. | Hang watchdog tests: 8 passed; oxlint passed. |
| ML-002 | `src/preload/preload-runtime-support.ts` | Installation functions could add duplicate global listeners if setup ran repeatedly, retaining closures and processing each drop more than once. | Added idempotent guards to native drop and browser-find listener installation. | Native chat drop scope test: 10 passed; oxlint passed. |

The ledger is updated as each agent returns a concrete finding or a verified
no-finding result. A fix gets its own commit so it can be proposed as a separate
PR.
