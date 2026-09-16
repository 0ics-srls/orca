# Agent status recovery foundation (C5 + C10)

## Scope and exact revision

This change integrates execution identity and committed launch membership in one
host-owned transaction. The pinned upstream base is
`b5a99462bced6871b8a1c711222bc58cff938b9f`; the branch was reconciled through
merge `2227d85138eb19bf4b2256233ea21acc7276d5b3`; the implementation tip is
`8b1d78d87ea5029d25539e929bad3685d355a641` (foundation commit
`165851414dde2cf4801b5d60b60553e7cefc5cf9`, parent
`0561ac9ff02f6d9e76c3ac0ef0980bee6d4b41f5`; the tip adds only bounded-owner
lint/type-boundary refactoring). The earlier identity source was
tree-equivalent to `22f80ab284`; the valid amend chain was inspected before
integration. The unrelated dirty `pnpm-lock.yaml` was preserved and is not in
the implementation commit.

## Failure mechanism and owner contract

Before this change, an ordinary fresh agent launch carried a launch
configuration but no `agentSessionClaim`. The PTY path therefore skipped
`agentSessionEnsure`, no committed owner was returned, and launch membership
could not be published until a provider hook happened (if it happened at all).
The fix is not another latch or registry: the existing
`ClaimedAgentPtyOwnerRegistry.ensure` reservation/promotion transaction now
creates one opaque `runId` plus `attachment.executionId`, passes the binding to
the provider through `ORCA_AGENT_STATUS_RUN_ID` and
`ORCA_AGENT_STATUS_EXECUTION_ID`, and returns the committed/adopted owner.
`owner.statusBinding` is the sole source for status attribution and
`agentHookServer.admitAgentSessionOwner` consumes that result on the canonical
surface after persistence and registration fences. A bare create-operation
replay (`id`/incarnation only) intentionally has no binding and remains
membership-free.

Launch membership is an orthogonal facet on the existing hook-store
compatibility row (`done` + `sessionBoundary`); it is not Working, readiness,
turn completion, unread, power-save activity, or a second journal. Hydrated
membership is `unconfirmed` until a complete, host-scoped owner inventory
re-admits it. Incomplete inventories never retire absence, and failed
publication/cleanup remains bookkeeping-only so terminal creation and user
dismissal are not blocked.

## Acceptance matrix

### C5 — execution identity and attribution

| Case | Result | Evidence / boundary |
| --- | --- | --- |
| One fresh launch mints one run and exact attachment | **Passed** | `ClaimedAgentPtyOwnerRegistry.ensure`; owner binding is returned through every local/runtime/daemon/relay/SSH path covered by provider tests. |
| Concurrent duplicate launch/adopt returns one owner | **Passed** | Owner-registry concurrency/adoption tests and IPC admission tests. |
| Replacement gets a new binding and continuity | **Passed** | Owner-registry replacement tests; delayed old exits are incarnation-fenced. |
| Lower-host canonical owner remains authoritative | **Passed** | IPC/daemon/relay owner propagation and canonical-surface commit tests. |
| Hook claim is resolved only against matching owner, surface, agent and binding | **Passed** | Resolver tests cover live owners and reservations during promotion; untrusted claims are suppressed. |
| Hook arrives before promotion completes | **Passed** | Reservation retains surface and binding; resolver attaches the event without downgrading it. |
| Legacy emitters without a claim retain the known subject but cannot replace it | **Passed** | Status-binding compatibility path and ingress tests. |
| Provider reset/alias chain and retained alias delta | **Partial** | Existing alias/reset machinery is preserved; an explicit retained-alias regression is still required for the complete C5 plan. |
| Nested/child emitter ancestry proof | **Gap** | Child-work contract is upstream, but this foundation does not prove ancestry for every nested emitter. |
| Manual/tmux/cron/Telegram discovery | **Gap** | No discovery producer was added; token/launch identity is not treated as emitter proof. |
| Subject-keyed store and all-reader cutover | **Gap** | Compatibility projection remains pane-keyed pending the host/replica cutover batch. |

### C10 — committed launch membership and recovery

| Case | Result | Evidence / boundary |
| --- | --- | --- |
| Native fresh launch publishes before first provider hook | **Passed** | Production-path IPC test derives a claim, reaches the provider, creates a status binding and admits one membership row. |
| Renderer-backed launch preserves one token across queue/remount retries | **Passed** | Desktop request and renderer transport/state plumbing carry the token/claim; IPC derives the claim at the choke point. |
| Headless/runtime controller fresh launch uses the same transaction | **Passed** | Runtime spawn/commit path and terminal creation characterization tests. |
| Daemon adoption returns the existing owner and canonical surface | **Passed** | Daemon owner-adoption and IPC recovery tests. |
| WSL/relay propagation of binding env and reported claim | **Passed at bounded seam** | Relay/provider tests cover env and envelope fields; full remote process fixture remains absent. |
| SSH/direct relay fresh claim | **Accepted gap** | Claim derivation fails closed until an attested route/host identity exists; no unsafe client-minted identity is used. |
| Silent startup is visible without fabricated Working/ready/done completion | **Passed** | Membership facet plus compatibility boundary row and worktree projection tests. |
| Bare create-operation replay stays membership-free | **Passed** | Server admission test and runtime replay characterization. |
| Spawn failure, cancellation and exit-before-registration | **Passed at ownership fence** | Registration-fence and provider exit tests release reservations and reject admission; full end-to-end vendor fixtures remain a gap. |
| Replacement and delayed old settlement | **Passed at identity fence** | Incarnation and owner replacement tests; complete provider alias settlement remains C5 follow-on. |
| Hydration/restart recovery | **Passed at bounded inventory seam** | Hydrated rows become unconfirmed, complete matching inventory re-admits, and complete absence retires only in scope. |
| Incomplete inventory/contact loss | **Passed** | Incomplete census retains membership; remote contact loss is uncertainty, never process death. |
| Dismissal/persistence failure | **Passed** | Failed bookkeeping does not block dismissal; provider resume identity may remain without launch membership. |
| Cursor/OpenCode delivery/readiness on Windows/WSL | **Gap** | Membership does not replace vendor adapters, command receipt, or readiness evidence. |
| Host replica epochs/cursors and mixed-version session-tab negotiation | **Gap** | Optional fields are wired, but publication-content negotiation and final reader cutover belong to the host composition batch. |

The matrix is intentionally not a claim that the complete C5 or C10 plans are
closed. Manual discovery, full alias/ancestry reconciliation, direct SSH
attested identity, vendor delivery/readiness, and replica negotiation remain
unimplemented follow-on work; this foundation must not be marked as a full
batch acceptance.

## Judgments

### Functional correctness

**Verified for the implemented foundation.** Fresh claims now reach the
provider and return an owner binding; adoption preserves the lower host's
binding and surface; exit-before-registration releases the owner fence; stale
incarnations cannot settle a replacement; provider events carrying a mismatched
claim are suppressed; membership survives only a complete matching inventory;
and persistence failures do not gate user actions. Bare replay results remain
membership-free. The remaining matrix gaps are unproved behavior, not hidden
assumptions.

### Architectural fit

**Verified for the C5/C10 boundary, incomplete for the whole wave.** Ownership,
delivery and lifecycle use the existing atomic owner transaction and canonical
execution-host store. No second reservation registry, run identity, journal,
reader precedence guard or unbounded retry was introduced. The compatibility
`done`/boundary row is a deliberate mixed-version deviation from a future
staged wire state; it keeps launch membership orthogonal to turn/readiness
semantics but requires the negotiated publication and reader cutover work still
owned by the host-composition batch.

### Concrete private precedent locations

Concrete source locations and mechanism comparisons are recorded in the
untracked private note `.c10-review-baseline.private.md`. The note records
which ownership, adoption, stale-event fencing and exit-ordering mechanisms
were verified, and which cross-host/status mechanisms remain unverified. No
private attribution is repeated in this public-safe artifact.

### Public-safe deviations

- The wire remains backward-readable through an optional launch-membership
  facet and legacy boundary projection; a new `starting` enum is not published
  to unnegotiated peers.
- Direct SSH fresh claims fail closed without attested execution-host identity;
  this preserves the `live` / `unverifiable` / `exited` contact boundary.
- Membership is retired only by a complete host-scoped owner census; omission
  from a partial snapshot is not process exit.
- Provider hook attribution requires the host-issued execution binding; launch
  token, title, cwd and pane labels are not proof.

## Reliability contract

- **Invariant / class:** `agent-session.provider-ownership` — one committed
  execution has one host-owned binding, and stale or foreign emitters cannot
  mutate it. `agent-session.launch-membership` — committed/adopted owners are
  visible before provider output without being interpreted as turn activity.
- **Failure source:** fresh launches bypassed the owner transaction, so rows
  appeared late or were absent; promotion and replacement races could also
  let early/late hook events attach to the wrong occupant.
- **Oracle:** the focused production-path tests assert provider receives the
  binding env, the canonical owner result admits exactly one row, mismatched
  claims are suppressed, reservations resolve during promotion, and complete
  versus incomplete inventories produce the expected retain/retire result.
- **Gate:** no dedicated blocking entry exists yet for this newly composed
  cross-host invariant; the changed-code quality gate and deterministic unit /
  provider-contract suites are the accepted experimental gate for this commit.
- **Provider/platform matrix:** local PTY and daemon paths are covered by unit
  seams; renderer IPC is covered; WSL and relay are covered at bounded envelope
  seams; SSH/direct relay fresh identity and full end-to-end remote providers
  are accepted gaps; mobile consumes the optional facet but final replica
  parity is a host-composition gap; macOS/Linux/Windows launch policy remains
  runtime-checked without Electron UI validation in this implementation task.
- **Performance budget:** the change adds no polling, timers, wake loops or
  broad process scans. Owner lookup is bounded by the existing registry cap
  (`MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES`); inventory reconciliation remains one
  bounded pass; resolver count tests cover live plus reservation entries.
- **Diagnostics:** provider spawn errors, ownership-unknown/exit-during-start
  errors, persistence failures and membership publication failures retain
  explicit log/error labels; focused tests preserve the binding and disposition
  in assertion output.
- **Residual gaps:** all matrix gaps above remain visible until their owning
  batches add evidence and negotiated publication support.

## Validation

Passed:

- `pnpm tc:node`
- `pnpm tc:web`
- `pnpm run check:code-quality:changed` (0 new findings)
- `pnpm exec oxfmt --check` on all changed TypeScript/TSX files
- `git diff --check`
- Foundation suite: 7 files, 51 tests passed
- Provider/runtime suite: 10 files, 112 tests passed
- Status/relay suite: 15 files, 225 tests passed with one pre-existing expected failure
- Runtime/daemon suite: 9 files, 151 tests passed
- Relay/provider contract suite: 4 files, 63 tests passed
- Hook transport/status suite: 3 files, 52 tests passed

No Electron app was launched and no native-focus or visible-window validation
was attempted. Full end-to-end daemon/SSH vendor fixtures, manual discovery,
replica negotiation, and the remaining C1/C2/C3/C4/C6/C7 behavior are not
covered by this implementation commit.

## Remaining work and disposition

This commit is a reusable C5/C10 foundation for dependent batches, not full
closure of both architecture plans. Dependents should consume
`owner.statusBinding` and `agentSessionEnsure` from implementation commits
`165851414dde2cf4801b5d60b60553e7cefc5cf9` and
`9adb2253c5d6a0cc0e5f29cd27bd0e94b0c9e895` and
`8b1d78d87ea5029d25539e929bad3685d355a641`; they must not mint another run or
reservation. Full batch completion requires the explicit gaps in the matrix,
with fresh independent review and provider/platform QA before any PR or merge.
