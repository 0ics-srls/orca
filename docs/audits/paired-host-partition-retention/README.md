# Explicit unpair leaves persisted host sessions

The current GUI environment-removal handler removes the saved environment and
invalidates its transport. It separately retires browser storage. It does not
remove that environment's `workspaceSessionsByHostId` partition. This confirms
one current persistence mechanism described in
[#12241](https://github.com/stablyai/orca/issues/12241), whose body explicitly
distinguishes it from the separate #12207 OOM mechanism.

## Actual-store reproduction

The bounded fixture creates 32 temporary saved environments, seeds one small
workspace session per environment through the actual Store, then invokes the
actual GUI removal handler for each. It uses real temporary JSON files and the
real environment catalog, Store serialization and reload. Electron registration,
transport retirement and browser storage are inert ports; there is no network,
window, native PTY or affected-host access.

After all 32 removals:

- saved environments: **0**;
- transport invalidations: **32**;
- host partitions in memory: **32**;
- host partitions on disk and after Store reload: **32**.

`results.json` records these counts and serialized fixture bytes. They are not
heap/RSS measurements and do not reproduce the report's historical magnitude.
The seeded sessions establish removal lifetime, not the historical import path.

The existing renderer suites
`runtime-host-purge-session-partition-split.test.ts` and
`set-runtime-environments-purge-wiring.test.ts` also pass (four tests). They remove
visible runtime rows and stop routing new normal writes to a removed partition;
neither asserts deletion of the existing main-process partition.

## Deletion alone is insufficient

Four additional controls first perform actual GUI unpair, then **simulate only
the proposed exact partition deletion** in the Store. A late write through each
actual handler recreates the absent partition:

- `session:set`;
- scalar `session:patch`, which bypasses full-session normalization;
- `session:set-sync`;
- `app:stage-before-unload-sync`, including successful durability acknowledgement.

This is a counterexample to a deletion-only proposal, not a claim that production
currently performs the simulated deletion. A safe fix needs to refuse stale
writers while preserving other snapshots and UI state during shutdown.

## Current ownership trace and limits

`setHostWorkspaceSession` preserves previous partitions when writing one host.
Scalar patch and PTY-binding persistence have additional direct partition writes.
Load normalization validates non-local partitions without consulting the paired
environment catalog. These lifetimes explain why catalog removal alone has no
effect on already persisted sessions.

Current paired-host mirroring loads `session.tabs.listAll` and subscribes to all
host snapshots. It applies each accepted snapshot to the renderer's session maps.
The older `importRemoteWorkspaceSession` helper cited in the issue now has a
direct SSH caller; this review does not assume the historical paired import path
still calls that helper. The current authoritative inventory flag is used for
hydration settlement; that alone is not evidence of persisted host-partition GC.

Local/SSH/folder ownership, duplicate workspace IDs on different hosts, pairing
repair, late publication and write failure all matter to a safe retirement rule.
Ordinary disconnect does not establish remote process exit. No time-based GC,
process termination, catalog absence pruning or product change is included here.
CLI environment removal has a separate transport issue with existing PR #21048;
this fixture exercises GUI removal only.

## Reproduce

```sh
ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run --config docs/audits/paired-host-partition-retention/config.mjs
```

Five current-source controls pass. The test uses the current checkout's imported
dependencies; `source-hashes.json` records selected reviewed boundaries, not an
exhaustive imported-module lock or historical-release execution. All temporary
profile data is removed after the fixture.
