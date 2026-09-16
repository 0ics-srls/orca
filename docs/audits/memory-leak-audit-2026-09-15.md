# Memory leak audit (2026-09-15)

Scope: all tracked JavaScript/TypeScript source outside `node_modules`, `.git`, and test files, including `src/`, `cloud/`, `config/`, `docs/site/`, and `tests/e2e` support code.

Command used:

```sh
rg --files -g '*.ts' -g '*.tsx' -g '*.js' -g '*.mjs' -g '*.cjs' -g '!node_modules/**' -g '!.git/**'
```

The audit then reviewed every production `.addEventListener`, `Event` subscription, timer, `DisposableStore`, `MutableDisposable`, and lifecycle callback occurrence. React effects and factory APIs were checked for teardown; abort listeners were checked for `{ once: true }` or explicit removal; pooled/session resources were checked for owner-scoped disposal.

Findings:

- Fifteen low-risk lifecycle leaks were fixed during the audit:
  - terminal editor close debounce timers are cleared on unmount (`7b527daf07`);
  - deferred Monaco diff-model disposal is coalesced and cancelled on unmount (`8613e91878`);
  - unexpected-signout auth retries are cancelled on unmount (`3ae769decd`);
  - the ephemeral-VM copied-prompt reset is coalesced and cancelled on unmount (`fd7ac01585`);
  - preload native-file-drop and browser-find installers are idempotent (`9e21318f86`);
  - mobile-markdown and terminal-tab-close IPC relays settle and remove listeners on renderer teardown (`9e21318f86`);
  - the combined-diff external-file-change listener is disposed during Vite HMR (`b43e985388`);
  - contextual-tour Escape listener teardown resets its HMR guard (`3fe8f7b6eb`);
  - activity pagehide listener teardown runs during Vite HMR (`a68b7aa080`);
  - keyboard-layout prefetch focus/API hooks are disposed during Vite HMR (`38e5dc8809`);
  - input-quiet scheduler global listeners are disposed during Vite HMR (`fa75b72697`);
  - the main-thread hang watchdog removes its app quit listener when stopped (`97adbf3f56`);
  - the terminal render-desync sentinel removes its opt-in mouseup listener during Vite HMR (`478c28c565`).
  - parked terminal retirement releases strong scroll-intent keys on tab close and worktree removal (`62b77fce3c`).
- Repeated renderer listeners have effect cleanup (including terminal sessions, visibility hooks, resize/drag hooks, audio tracks, and primary-selection handling).
- Main/relay abort listeners are one-shot or explicitly removed on settlement.
- Browser grab overlays remove listeners in `freezeHighlight`/`cleanup`; repeated arming tears down the prior overlay.
- Module-level listeners (input quiet scheduler, crash diagnostics, activity pagehide, keyboard-layout cache) are intentional process/renderer singletons and are installed at most once.
- The hidden-worktree retention pass found a deliberate fail-open exemption: local PTYs with unknown or unrestorable snapshot capability keep their mounted xterm panes through force-park. This can retain full scrollback without a finite pane bound; force-unmounting is unsafe until those PTYs are reattachable.

The reproducible tracked-file inventory is [memory-leak-file-inventory-2026-09-15.tsv](./memory-leak-file-inventory-2026-09-15.tsv). It was generated from `git ls-files`, reads and SHA-256 hashes every path, and classifies every file as `source`, `config`, `documentation`, or `asset-or-other`:

| Category | Files |
| --- | ---: |
| Source | 25,459 |
| Config | 770 |
| Documentation | 240 |
| Asset/other | 201 |
| **Total** | **26,670** |

The inventory was generated before committing itself and the scan ledger, so it contains one row for each of the 26,669 inventoried tracked files. The two current tracked paths absent from its rows are the inventory file itself and this scan ledger; the inventory file SHA-256 is `c652399e666ae2682fc05af5751ebf38c8613eb409f24b06099705ac6ff4ecf0`. Thus the current checkout is fully accounted for: 26,669 inventoried files plus these two evidence paths.

The source pass inspected all 25,459 source files with the listener, timer, subscription, disposable, and lifecycle searches described above. The final pattern totals were: `addEventListener` 1,553 / `removeEventListener` 1,197; `setTimeout` 3,932 / `clearTimeout` 1,846; `setInterval` 382 / `clearInterval` 217; `subscribe(` 1,312 / `unsubscribe` 3,282. The remaining timer candidates were inspected and classified as process-scoped diagnostics, explicitly owned intervals, or bounded one-shot callbacks.

This report is evidence of the full-codebase scan; rerun the command above after changes to refresh the inventory.
