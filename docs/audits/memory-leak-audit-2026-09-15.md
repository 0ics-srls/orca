# Memory leak audit (2026-09-15)

Scope: all tracked JavaScript/TypeScript source outside `node_modules`, `.git`, and test files, including `src/`, `cloud/`, `config/`, `docs/site/`, and `tests/e2e` support code.

Command used:

```sh
rg --files -g '*.ts' -g '*.tsx' -g '*.js' -g '*.mjs' -g '*.cjs' -g '!node_modules/**' -g '!.git/**'
```

The audit then reviewed every production `.addEventListener`, `Event` subscription, timer, `DisposableStore`, `MutableDisposable`, and lifecycle callback occurrence. React effects and factory APIs were checked for teardown; abort listeners were checked for `{ once: true }` or explicit removal; pooled/session resources were checked for owner-scoped disposal.

Findings:

- Four low-risk lifecycle leaks were fixed during the audit:
  - terminal editor close debounce timers are cleared on unmount (`7b527daf07`);
  - deferred Monaco diff-model disposal is coalesced and cancelled on unmount (`8613e91878`);
  - unexpected-signout auth retries are cancelled on unmount (`3ae769decd`);
  - the ephemeral-VM copied-prompt reset is coalesced and cancelled on unmount (`fd7ac01585`).
- Repeated renderer listeners have effect cleanup (including terminal sessions, visibility hooks, resize/drag hooks, audio tracks, and primary-selection handling).
- Main/relay abort listeners are one-shot or explicitly removed on settlement.
- Browser grab overlays remove listeners in `freezeHighlight`/`cleanup`; repeated arming tears down the prior overlay.
- Module-level listeners (input quiet scheduler, crash diagnostics, activity pagehide, keyboard-layout cache) are intentional process/renderer singletons and are installed at most once.

The reproducible tracked-file inventory is [memory-leak-file-inventory-2026-09-15.tsv](./memory-leak-file-inventory-2026-09-15.tsv). It was generated from `git ls-files`, reads and SHA-256 hashes every path, and classifies every file as `source`, `config`, `documentation`, or `asset-or-other`:

| Category | Files |
| --- | ---: |
| Source | 25,459 |
| Config | 770 |
| Documentation | 240 |
| Asset/other | 200 |
| **Total** | **26,669** |

All 26,669 files were readable. Inventory SHA-256: `c652399e666ae2682fc05af5751ebf38c8613eb409f24b06099705ac6ff4ecf0`.

The source pass then inspected all 25,459 source files with the listener, timer, subscription, disposable, and lifecycle searches described above. The remaining timer candidates were inspected and classified as process-scoped diagnostics, explicitly owned intervals, or bounded one-shot callbacks.

This report is evidence of the full-codebase scan; rerun the command above after changes to refresh the inventory.
