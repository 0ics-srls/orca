# Memory leak audit coverage (2026-09-15)

This ledger records the full repository scan for the `memory-leak-audit` and
`memory-leak-debugging` skills. Source ownership was split across agents, but
all edits are made in this worktree and every area below is accounted for.

## Coverage

| Area | Files scanned | Audit owner | Status |
|---|---:|---|---|
| `src/renderer` | tracked TS/TSX/JS/JSX | renderer agent | in progress |
| `src/main` | tracked TS/TSX/JS/JSX | main agent | in progress |
| `src/preload` + `src/shared` | tracked TS/TSX/JS/JSX | preload/shared agent | in progress |
| `mobile` | tracked TS/TSX/JS/JSX | root | reviewed; targeted follow-up pending |
| `cloud` | tracked TS/TSX/JS/JSX | root | reviewed; targeted follow-up pending |
| `tests` | tracked TS/TSX/JS/JSX | root + area owners | reviewed for production listener fixtures |
| `config` | tracked TS/TSX/JS/JSX | root | reviewed; build/test lifecycle only |
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
| ML-001 | pending | pending agent report | pending | pending |

The ledger is updated as each agent returns a concrete finding or a verified
no-finding result. A fix gets its own commit so it can be proposed as a separate
PR.
