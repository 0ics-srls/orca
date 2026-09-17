# AI Vault scanner shutdown custody

Related: [#18200](https://github.com/stablyai/orca/issues/18200). Current production code has no scanner shutdown entry in the committed application quit barrier. The shared scanner client is disposed only by its test reset function. The child handles parent disconnect by aborting active work, waiting for its lanes, flushing its parse cache, and disconnecting. Its executable can therefore remain needed after parent shutdown starts.

## Controlled observations

Four actual-client controls pass on Node 26.6 and Electron 43.7 / Node 24.21:

| Case                                              | Observed current behavior                                                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispose a ready child                             | Returns `undefined` immediately; sends shutdown and requests kill after two seconds without observing exit.                                           |
| Child exits within grace period                   | Exit listener cancels the kill timer.                                                                                                                 |
| Dispose while invalidation awaits child readiness | Invalidation is still pending after 60 seconds of controlled clock time. The ready timeout cannot reject it once `child` is null.                     |
| Readiness resolves immediately before dispose     | The invalidation continuation sends after shutdown, with no message listener left to receive its acknowledgement; it stays pending past its deadline. |

The last two are latent disposal races relevant to adding a quit drain. They do **not** demonstrate an ordinary production memory-growth loop: production currently has no such disposal caller. Pending promises alone are not a measured heap leak or an explanation of #19831.

## Reproduce

From the worktree root:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config docs/audits/scanner-shutdown-custody/config.mjs
```

Set `ORCA_SCANNER_CUSTODY_OUTPUT` to save observations elsewhere. Electron runs use its installed executable with `ELECTRON_RUN_AS_NODE=1`. The config fences nine selected source files. The client, request/retirement logic, and timers execute actual code; the existing test child is an EventEmitter port and the clock is controlled. No native child, Electron window, mount, systemd service, SIGBUS, or process RSS is reproduced. These are current-source controls, not a complete historical source graph replay. `source-versions.json` records selected main and v1.4.195 identities; the historical quit code lived in a different file and is not executed here.

## Fix boundary under review

A useful fix must add a singleton shutdown entry to the existing committed quit barrier, stop new admissions, reject startup waiters, guard post-await invalidations, and keep custody of already-retiring children until exit or an explicitly reported deadline. Reusing the existing two-second grace alone does not prove exit. A simple `await client.dispose()` would still return immediately.

This can address scanner teardown ordering only. Linux's deliberately surviving terminal daemon needs a stable executable backing lifetime; killing it when its AppImage mount disappears would destroy live work. Service-manager teardown of the mount can also occur independently of parent cleanup. No product change is included in this evidence artifact.
