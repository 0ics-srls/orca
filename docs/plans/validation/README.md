# TCC recovery detector validation — 2026-09-14

Scope: validate the proposed old-daemon-compatible transport and lifecycle mechanics, then
independently review the design. This is not a reproduction of TCC poisoning.

## Evidence

The harness launches its own isolated daemon process using `startDaemon`, `DaemonClient`, and
the production `createPtySubprocess` path. It creates fresh temporary runtime directories and
uses a compiled C executable as `shellOverride`, with no command input. The parent driver is
Node, not the installed Electron app. No existing user daemon was restarted, no user session
was touched, and no TCC permission or app bundle was modified.

Both runs explicitly reported the actual launch strategy: `direct` and `wrapped` respectively.

| Case | Helper result | Driver result | Cleanup |
| --- | --- | --- | --- |
| Readable directory with spaces, quote, dollar sign, backticks, newline | errno 0 | ok | No live or retained diagnostic session |
| Missing directory | errno 2 | ENOENT | No live or retained diagnostic session |
| Fixture directory chmod 000 | errno 13 | EACCES | No live or retained diagnostic session |
| Sleeping helper, client kills its session | No access verdict inferred | Not applicable | PID absence confirmed with ESRCH |
| Sleeping helper, no client kill | No access verdict inferred | Not applicable | Five-second helper alarm; PID absence confirmed |

Both daemon processes exited with code 0 after the harness shut them down. Fixture directory
permissions were restored after each run. The small temporary runtime directories were retained
for inspection; generated bundle removal does not affect the retained source.

The first harness iteration used the wrong event field (`payload.sessionId` instead of
`event.sessionId`); the second attempted to kill a session already reaped after normal exit.
Both harness issues were corrected before the successful runs. Normal cleanup tolerates only
the specific already-reaped error, not arbitrary failures.

Existing regression suites:

```sh
ORCA_BACKGROUND_LAUNCH=1 node_modules/.bin/vitest run --config config/vitest.config.ts \
  src/main/daemon/terminal-host-cwd-readability.test.ts \
  src/main/daemon/daemon-adoption-telemetry-event.test.ts \
  src/main/daemon/daemon-tcc-attribution.test.ts
```

Result: **3 files passed, 22 tests passed**.

Historical source check: `git show a7fda48fe3^:src/main/daemon/types.ts` and the corresponding
`pty-subprocess/shell-launch-plan.ts` confirmed that `shellOverride`, `env`, and Unix executable
launch support existed before cwd-readability telemetry. No historical binary was executed.

## Reproduce the transport checks

From this worktree, with host-compatible node-pty already available:

```sh
TCC_PROBE_BUILD_DIR=$(mktemp -d /tmp/orca-tcc-validation.XXXXXX)
clang -Wall -Wextra -O2 docs/plans/validation/tcc-directory-probe.c \
  -o "$TCC_PROBE_BUILD_DIR/directory-probe"
node_modules/.bin/esbuild docs/plans/validation/tcc-probe-validation.ts \
  --bundle --platform=node --format=cjs --packages=external \
  --outfile=docs/plans/validation/tcc-probe-validation.cjs
ORCA_BACKGROUND_LAUNCH=1 node docs/plans/validation/tcc-probe-validation.cjs \
  "$TCC_PROBE_BUILD_DIR/directory-probe"
ORCA_BACKGROUND_LAUNCH=1 ORCA_PROBE_WRAPPED=1 \
  node docs/plans/validation/tcc-probe-validation.cjs "$TCC_PROBE_BUILD_DIR/directory-probe"
```

The harness is a macOS experiment, not shipping code. Wrapped mode requests the production
login preflight; check the emitted actual strategy, since an unavailable login wrapper can
fall back to direct. The helper contains a test-only stall switch. Production packaging,
strict protocol parsing, queue limits, absolute deadlines, and crash-path cleanup need separate
implementation and tests.

## Independent review

A second agent reviewed the current protocol, shell launch, session listing, login wrapper,
and environment handling. It recommended using the tiny executable instead of a diagnostic
shell command, avoiding permanent success caching, and treating old-reader visibility and
late-create cleanup explicitly. Those findings are incorporated in the design.
Its final review also caught a trigger gap: checks must include failed terminal admission,
since permission denial can prevent creation. The rewritten design includes that correction.

## What this does not prove

- No known poisoned daemon was available in the validation fixture.
- chmod denial is POSIX permission behavior, not TCC; both tested sides were denied.
- The unsigned prototype does not establish the final signed helper's TCC attribution.
- A child can acquire different attribution under the login wrapper or executable identity.
- Current-daemon protocol execution plus historical source inspection is not old-binary proof.
- The helper alarm bounds an ordinary sleep, not an uninterruptible filesystem operation.
- No actual restart or rendered notice was tested; there is no production UI change yet.

The shipping gate remains: affected ordinary terminal denied, final packaged helper denied,
Electron main succeeds, then terminal/helper reads succeed after explicit restart.
