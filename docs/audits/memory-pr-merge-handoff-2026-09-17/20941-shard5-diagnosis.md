# #20941 refreshed CI failure: existing renderer-test teardown

**Recommendation: retain this failure and rerun only the failed shard after the workflow finishes. No stats-patch-specific blocker was found. Require successful replacement checks before merging.** No product changes or unrelated cleanup work are proposed for this stats PR.

## Exact observed failure

- PR head: `7c6e8a9ba9cf9794aaaadcf946e6cfc4be457b61`.
- [Failed job](https://github.com/stablyai/orca/actions/runs/35302224931/job/105467162920): Node 24, shard 5/8.
- Checkout log identifies tested merge `0d6a0265c9ef25784b4d30faa09ae191b028ed46`, merging that head into `9c921360090667e02363fe6e4dee98410665427a`.
- All **1,115 executed test files / 10,321 tests passed**. Five files / 22 tests were skipped. The job failed on one unhandled exception, not a failed assertion.
- The exception is `ReferenceError: window is not defined`. Its stack identifies `Timeout._onTimeout` in `use-subagent-sessions.ts:19`: the 200 ms callback `setShowLoading(true)`. React then accesses the absent global window.
- Vitest attributes the exception to `AiVaultSessionSubagents.test.tsx`; that file's 18 tests passed. The raw log and a focused excerpt are retained alongside this report.

## Source provenance and relation to #20941

`20941-shard5-provenance.json` records exact Git blobs for the original reviewed head, refreshed head and tested baseline main. The subagent hook, test, production component, Vitest configuration and host-port setup are byte-identical across all three. The stats production patch is also unchanged by the branch refresh.

The only production change is four added lines in `StatsCollector.record`: trim its own event array to the existing 10,000-event retention policy. It does not alter any hook, renderer listener, timeout API, React lifecycle or test configuration. The hook imports React and an erased session type; its loading timer is owned by its effect and is canceled by that effect's cleanup or request settlement. The stats code cannot change that ownership through the inspected source paths. The new `collector-async-save.test.ts` does not appear among the failed shard's executed tests, so its fake timers are not the direct source of this shard's callback.

## Concrete existing test-teardown diagnostic

The test file's `afterEach` calls only `document.body.replaceChildren()`. Removing DOM children does not unmount React roots or run effect cleanups. One test intentionally leaves its replacement-parent listing Promise pending; the corresponding 200 ms timer therefore needs an actual component unmount to clear it.

The inspected Testing Library entry point registers automatic cleanup only when a global `afterEach` or `teardown` exists. This repository's Vitest configuration does not enable globals, and the inspected Vitest default is `globals: false`; importing `afterEach` into the test module does not create that global. The failed command does not pass `--globals`. This supplies a concrete existing ownership gap consistent with the observed loading timer firing after the happy-dom window disappears.

The log now identifies the precise callback, unlike earlier same-family React teardown failures on #20981/#21009/#21010. This review did not run a controlled reproduction of the environment teardown, so it does not claim the whole scheduler interleaving has been reproduced or that every prior failure had the same callback.

## Bounded next-review note

For a separate test-maintenance review, replace raw DOM removal with Testing Library's `cleanup()` in this fixture (or explicitly unmount every rendered root), then verify that the pending-listing case clears its timer on teardown. The production hook already clears the timer on real unmount; do not change its user-facing loading behavior merely to hide the test error.

This investigation performed one read-only job-log download and local source/blob inspection. It did not rerun workflows, run tests, edit source, change refs or create a PR.
