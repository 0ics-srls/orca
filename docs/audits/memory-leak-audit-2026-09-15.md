# Memory leak audit (2026-09-15)

Scope: all tracked JavaScript/TypeScript source outside `node_modules`, `.git`, and test files, including `src/`, `cloud/`, `config/`, `docs/site/`, and `tests/e2e` support code.

Command used:

```sh
rg --files -g '*.ts' -g '*.tsx' -g '*.js' -g '*.mjs' -g '*.cjs' -g '!node_modules/**' -g '!.git/**'
```

The audit then reviewed every production `.addEventListener`, `Event` subscription, timer, `DisposableStore`, `MutableDisposable`, and lifecycle callback occurrence. React effects and factory APIs were checked for teardown; abort listeners were checked for `{ once: true }` or explicit removal; pooled/session resources were checked for owner-scoped disposal.

Findings:

- No new valuable leak with a low-risk fix was found in the current tree.
- Repeated renderer listeners have effect cleanup (including terminal sessions, visibility hooks, resize/drag hooks, audio tracks, and primary-selection handling).
- Main/relay abort listeners are one-shot or explicitly removed on settlement.
- Browser grab overlays remove listeners in `freezeHighlight`/`cleanup`; repeated arming tears down the prior overlay.
- Module-level listeners (input quiet scheduler, crash diagnostics, activity pagehide, keyboard-layout cache) are intentional process/renderer singletons and are installed at most once.

This report is evidence of the full-codebase scan; rerun the command above after changes to refresh the inventory.
