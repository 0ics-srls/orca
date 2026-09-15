# C10 implementation result

## Completed cases and evidence

- **Committed/adopted launch membership:** Added the host-owned launch-membership facet and admission path. `PtySpawnResult.agentSessionEnsure.owner.statusBinding` is the only source of `runId` and `attachment.executionId`; admission runs after PTY registration and early-exit validation, using the owner's final canonical surface. The existing owner result is used directly; no second reservation or C5 callback was added.
- **Bare create-operation replay:** A result containing only `{ id, incarnationId }` is treated as deduplication evidence. It cannot seed a pane row or invoke membership publication. Regression coverage is in `terminal-creation-and-readiness-part-02.spec.ts`.
- **Silent startup:** A committed or adopted owner publishes one compatibility row before provider output. The legacy state remains `done` with `sessionBoundary: true`; `launchMembership` is the authoritative presence facet, so launch does not become Working, waiting, completion, unread, or power-save activity.
- **Adoption and repeated requests:** Created and adopted owner results retain the same binding and canonical surface. The runtime callback is emitted after registration for both dispositions; the focused OMP resume test verifies the shared binding is forwarded unchanged.
- **Host inventory recovery:** Persisted membership hydrates as `unconfirmed`. Complete owner inventories re-admit matching live owners, restore canonical tab/leaf/handle metadata, clear stale hydration state, and retire only rows in the covered host scope that are absent. Incomplete inventories never retire absence; local and SSH scopes are reconciled independently.
- **Lifecycle cleanup:** Failed/exited settlement removes membership without making persistence a user-action gate. Dismissal retains provider resume identity only and drops launch membership.
- **Reader projections:** The facet is carried through agent-status IPC, renderer state, mobile/session-tab projections, `worktree ps`, and worktree activity rollups. Committed membership keeps a row visible while contributing neither Working nor permission status. Connected-PTY gating is bypassed only for a committed launch facet.

The C5 dependency is the shared owner contract in `1d3783e091` (tree-equivalent to `22f80ab284`), with the accompanying handoff at `f167c637f0`. The implementation consumes `owner.statusBinding` and does not mint a competing run or attachment identity.

## Judgments

### Architecture fit

**Fit: verified for the C10 boundary.** Admission is attached to the existing claimed-owner transaction and consumes its committed/adopted result. Membership is an orthogonal host fact, not a turn reducer, readiness claim, provider journal, or second reservation registry. Complete inventory coverage is required before absence retires a row, and bookkeeping errors do not block terminal creation or dismissal.

### Functional correctness

**Correctness: verified for the covered cases.** Focused tests cover silent admission, bare replay rejection, provider transition carry-forward, adoption, failed settlement, dismissal, persistence/hydration, complete versus incomplete inventory, host-scoped retirement, and the worktree rollup. The aggregate runtime suite covers the new post-registration callback and existing create/adopt paths. Remote contact loss remains uncertainty rather than process death.

### Concrete precedent and deviations

The inspected implementations consistently create a pre-execution membership record from the owning lifecycle, keep it separate from turn activity, and retire it from authoritative host inventory. Orca differs materially where it must: PTY agents can be on an SSH execution host, so client contact or a partial inventory cannot prove exit; and mixed-version readers receive a legacy `done`/boundary projection plus an optional membership facet instead of a new wire state. Those differences are deliberate and remain subject to the host replication and compatibility work owned by C7.

### Validation

- `pnpm tc:node`
- `pnpm tc:web`
- Focused launch/projection tests: 17 passed across 3 files; additional status/runtime regression set: 87 passed across 8 files.
- Aggregate `src/main/runtime/orca-runtime.test.ts`: **1,268 passed, 1 skipped**.
- `node config/scripts/check-changed-code-quality.mjs`: 0 new findings in all gates.
- `git diff --check`: passed.

## Remaining gaps

- Provider hook delivery and readiness/receipt behavior for Cursor/OpenCode on Windows/WSL are not fixed by membership; those remain C4/C3 work.
- Emitter attribution, subject-keyed status storage, manual/nested discovery, and full provider-alias reconciliation remain C5 work beyond the consumed owner binding.
- Host composition, replica stream epochs/cursors, mixed-version/session-tab negotiation, and final reader cutover remain C7 work. This batch adds optional fields but does not claim the cross-version transport contract is complete.
- Canonical turn/outcome reduction and lost completion/child recovery remain C1/C2 work; exact attachment execution observation remains C6 work.
- A complete end-to-end daemon/SSH process fixture with a real provider is not included here; the owner inventory and runtime seams are covered with bounded unit fixtures. Remote absence remains `unverifiable` until the owning host answers.

## Required sibling commits

- C5 owner binding: `22f80ab284` (and handoff `f167c637f0`; consumed tree is `1d3783e091`).
- C7 host-domain composition and negotiated replica publication before relying on the new facet across paired clients.
- C3 readiness/command-receipt evidence, C4 provider delivery adapters, C6 exact-attachment observation, and C1/C2 shared lifecycle/recovery reducers for their respective follow-on cases.

## Commit

Pending local implementation commit.
