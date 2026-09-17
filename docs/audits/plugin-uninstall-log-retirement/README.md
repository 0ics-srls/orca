# Plugin logs after successful uninstall

Successful uninstall previously removed the plugin and its worker while retaining up to 200 log rows under its key. Repeating this across distinct keys retained every old ring. Old worker callbacks could also append into a same-key reinstall; a late stdout tail could write after worker exit and uninstall.

The fix clears a key only after worker deactivation and filesystem removal both succeed. Worker, panel and event producers capture the current log-entry token before asynchronous work. Clearing the entry invalidates those callbacks without retaining the old row array or adding permanent key tombstones. Installed stopped/crashed history and failed-removal history keep their existing policy.

## Removal authority

Removal joins the existing refresh chain and resolves the installed object after earlier refreshes finish. A normal refresh replaces discovery objects, so capturing one before joining that queue would incorrectly reject an authorized uninstall. Fresh command, panel and event work for the selected object is blocked while removal owns it; failure restores admission.

The service rechecks bundled ownership before deactivation. The filesystem remover independently rechecks it inside the existing per-directory mutation queue, before deleting files or lock ownership. This protects a newly bundled revision published while the old worker is stopping. The fixture publishes genuinely different bytes: reinstalling identical bytes preserves the previous immutable provenance and does not establish a bundled successor.

A successful removal retires the exact discovered object before a later refresh can publish a successor. This changes no wire format or execution-host policy. There is no process-death inference, extra queue, broad history cap, or kill policy change.

## Evidence

The four-control portable comparison uses actual service, IPC handler, installer, discovery, worker runtime, IPC parsing and stdout framing. Worker fork/exit transport, Store settings access and imported plugin code are controlled ports; real temporary files exercise installation and removal. No native worker process or app window is created.

| Control                                                 | Before                                     | Fixed                 |
| ------------------------------------------------------- | ------------------------------------------ | --------------------- |
| Eight distinct successful uninstalls, 205 SDK rows each | 8 keys / 1,600 rows / 8 sampled rows alive | 0 / 0 / 0             |
| Old callbacks held after identical-key reinstall        | Old log accepted                           | Successor log remains |
| Worker exit precedes final stdout end                   | Retired tail retained                      | No retired key        |
| Installed SDK / malformed raw IPC bounds                | 8,192-code-unit SDK limit; 200 rows        | Same                  |

Old fake worker objects remain rooted during the collection control. WeakRefs measure reachability of sampled row objects, not RSS or byte savings. Bounded synthetic callback ordering is not a claim that a native worker produced that ordering in an affected incident.

All 89 tests pass across the 17 permanent regressions and 72 existing compatibility tests. The 17 permanent regression controls additionally cover partial filesystem failure/retry, late panel and event diagnostics, refresh-before-remove, changed revisions, both bundled checks, queued identical reinstall, admission restoration, service disposal and installed crash history. Existing compatibility suites cover the host runtime, controller, panel, installer, integrity/reconciliation and IPC behavior.

## Source scope and reproduction

`source-versions.json` records exact source hashes. The original eight changed product baselines match named main `291b4ddd6f1c1af480169885e0fda7f9c78ff053` and reported v1.4.198 `e0826956fcfc532f5a1e55b5e081f2e57e553c43`. The comparison uses explicitly fenced current dependencies; it is not a replay of either whole historical checkout. The small `dependency-context.patch` reconstructs four current dependency differences when running from published main. Tests and fixture modules travel with this change. The new ninth product module, `plugin-installation-state.ts`, contains the extracted installation/log state and removal transaction. It is absent from both named baselines; the service remains the sole refresh-queue owner. The source inventory supplies 249 before / 250 fixed repository paths (including the optional baseline test), with six package manifests. Actual comparative evaluation loads 246 before / 247 fixed repository paths.

The loader reverses the exact zero-context fix for the before run, verifies every supplied repository source and package-manifest hash, and rejects unfenced runtime repository imports. The loader controls verify CRLF normalization, source drift rejection and a simulated publication checkout. Installed third-party runtime code is represented by the recorded package manifests, not claimed byte-identical to historical packages.

From the repository root:

```sh
ORCA_BACKGROUND_LAUNCH=1 ORCA_PLUGIN_LOG_VARIANT=before pnpm exec vitest run --config docs/audits/plugin-uninstall-log-retirement/phase.config.mjs
ORCA_BACKGROUND_LAUNCH=1 ORCA_PLUGIN_LOG_VARIANT=fixed pnpm exec vitest run --config docs/audits/plugin-uninstall-log-retirement/phase.config.mjs
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/plugin-uninstall-log-retirement/loader-controls.cjs
```

For Electron's installed Node runtime, use the installed Electron executable with `ELECTRON_RUN_AS_NODE=1 ORCA_BACKGROUND_LAUNCH=1` and `node_modules/vitest/vitest.mjs` followed by the same `run --config` arguments. `ORCA_PLUGIN_LOG_OUTPUT` and `ORCA_PLUGIN_LOG_LOADER_OUTPUT` select alternate report paths. `before.config.mjs` runs the six permanent retention cases against baseline and is expected to fail those retention assertions.

## Limits

This explains a code-level main-process owner that survives successful uninstalls. It does not establish plugin usage, uninstall rate, field allocation size, or attribution for #19831 or any other incident. Installed, disabled, crashed, development and externally deleted plugin histories are not comprehensively retired by this change. Sequential filesystem deletion is not a rollback transaction; failure retains discovery/history for retry. The in-process mutation queues do not make external or cross-process lockfile edits atomic. If a bundled successor appears during shutdown, the old worker may already have stopped before removal is refused; the successor remains installed and can activate afterward.
