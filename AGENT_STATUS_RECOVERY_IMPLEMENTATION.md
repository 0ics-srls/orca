# Agent status recovery foundation (C5 + C10)

## Scope and exact revision

This change integrates execution identity and committed launch membership in one
host-owned transaction. The pinned upstream base is
`b5a99462bced6871b8a1c711222bc58cff938b9f`; the branch was reconciled through
merge `2227d85138eb19bf4b2256233ea21acc7276d5b3` and later upstream merge
`4f51c3815fdafbadfa736ec04e22d79c9b76bdfc`. The exact implementation HEAD is
`e30e6b769ce1fdad26ecc028e4a3c572f0f58e90` (parent
`f3d96ae342b995854e6185ab67ce9e62a152ef3e`); the exact validated code/test tip
is `5b2325ef4ec76e3d95e59ccc27d8d1743219e490`. The foundation commit
`165851414dde2cf4801b5d60b60553e7cefc5cf9` consumes the tree-equivalent C5
identity source (`22f80ab284`); the valid C5 amend chain was inspected before
integration. The unrelated dirty `pnpm-lock.yaml` was preserved and is not in
the implementation commits.

## Failure mechanism and owner contract

The original launch failure was that an ordinary fresh agent launch carried a
launch configuration but no `agentSessionClaim`. The PTY path therefore
skipped `agentSessionEnsure`, returned no committed owner, and could not
publish launch membership before a provider hook. The recovery foundation
fixed that without another latch or registry: the existing
`ClaimedAgentPtyOwnerRegistry.ensure` reservation/promotion transaction now
creates one opaque `runId` plus `attachment.executionId`, passes the binding to
the provider through `ORCA_AGENT_STATUS_RUN_ID` and
`ORCA_AGENT_STATUS_EXECUTION_ID`, and returns the committed/adopted owner.
`owner.statusBinding` is the sole source for status attribution and
`agentHookServer.admitAgentSessionOwner` consumes that result on the canonical
surface after persistence and registration fences. A bare create-operation
replay (`id`/incarnation only) intentionally has no binding and remains
membership-free.

The follow-up discovery failure was more specific: process inventory found a
foreground provider command, while hook ingress supplied only pane-scoped
session metadata. Freshness did not prove that the session belonged to that
exact process, so a nested child or delayed observation could be promoted as a
new root. This commit replaces that inference. POSIX hooks report their parent
PID; the execution host resolves the first recognized provider in that live
parent chain and records its exact PID/start-time incarnation. Admission now
requires that proof to equal the foreground process, rejects a recognized
provider ancestor, and additionally fences local discoveries by the observed
terminal handle and PTY incarnation. POSIX relay-hosted SSH uses the same
proof and the same atomic owner transaction.

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
| Provider reset/alias chain and retained alias delta | **Passed at store seam** | Canonical-store regression proves pre-reset and post-reset aliases remain on one run/attachment, including delayed exit settlement; provider-specific alias discovery remains follow-on. |
| Nested/child emitter attribution | **Passed for POSIX native and relay discovery** | Hook-emitter ancestry is resolved on the execution host; recognized child providers and inherited child metadata cannot promote or re-key the root. Windows, WSL and multiplexer ancestry remain explicit platform gaps below. |
| Manual native/headless discovery | **Passed for POSIX direct PTYs** | Runtime inventory joins exact PTY root/incarnation, foreground provider process, hook-emitter PID/start-time and provider session, then admits through the existing owner transaction. Cwd/title/token alone remain rejected. |
| Manual POSIX SSH/relay discovery | **Passed at the negotiated relay boundary** | The relay resolves hook emitter ancestry, publishes the optional discovery proof, and the SSH provider admits it only when the relay capability is present. Mixed-version peers omit the optional proof. |
| WSL, Windows relay, tmux/screen, cron/Telegram discovery | **Gap** | Each lacks a required execution-host join: guest process inventory for WSL, Windows creation-time/job ancestry, active multiplexer pane root, or explicit non-PTY automation membership. No fallback inference is used. |
| Subject-keyed store and all-reader cutover | **Gap** | Compatibility projection remains pane-keyed pending the host/replica cutover batch. |

### C10 — committed launch membership and recovery

| Case | Result | Evidence / boundary |
| --- | --- | --- |
| Native fresh launch publishes before first provider hook | **Passed** | Production-path IPC test derives a claim, reaches the provider, creates a status binding and admits one membership row. |
| Renderer-backed launch preserves one token across queue/remount retries | **Passed** | Desktop request and renderer transport/state plumbing carry the token/claim; IPC derives the claim at the choke point. |
| Headless/runtime controller fresh launch uses the same transaction | **Passed** | Runtime spawn/commit path and terminal creation characterization tests. |
| Daemon adoption returns the existing owner and canonical surface | **Passed** | Daemon owner-adoption and IPC recovery tests. |
| WSL/relay propagation of binding env and reported claim | **Passed at bounded launch seam** | Relay/provider tests cover env and envelope fields; WSL manual-discovery admission remains open because guest-owned PTY/process proof is not yet in the host inventory. |
| SSH/direct relay fresh claim and POSIX discovery | **Passed at negotiated host seam** | SSH capability negotiation requests `pty.issueAgentSessionClaim`; the relay signs with a persistent execution-host key and now publishes exact POSIX emitter-process proof for manual discovery. Old/no-capability relays retain legacy behavior without claiming process death. |
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
closed. WSL and Windows discovery joins, multiplexer roots, detached automation
membership, vendor delivery/readiness, the subject-keyed reader cutover, and
replica negotiation remain follow-on work. This implementation must not be
marked as full batch acceptance.

## Judgments

### Functional correctness

**Verified for the implemented POSIX foundation.** Fresh claims reach the
provider and return an owner binding; adoption preserves the lower host's
binding and surface; exit-before-registration releases the owner fence; stale
incarnations cannot settle a replacement; and persistence failures do not gate
user actions. Manual native/headless and POSIX relay discovery now require the
same foreground process incarnation as the hook emitter and reject nested
provider ancestors, delayed old observations, replayed proof and foreign
terminal/PTY identities. Bare operation replay remains membership-free. The
remaining matrix gaps are unproved behavior, not hidden assumptions.

### Architectural fit

**Verified for the implemented C5/C10 boundary, incomplete for the whole
wave.** Ownership, delivery and lifecycle use the existing atomic owner
transaction and canonical execution-host store. Discovery adds proof to that
transaction instead of creating another owner or status authority. No second
reservation registry, run identity, journal, reader precedence guard, timer or
unbounded retry was introduced. The compatibility
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
- Managed hook attribution requires the host-issued execution binding. Manual
  discovery requires exact execution-host process, emitter ancestry, PTY and
  terminal proof; launch token, title, cwd and pane labels are not proof.
- Unsupported WSL, Windows, multiplexer and detached-automation discovery
  returns no candidate. It never downgrades the verdict to inferred `live`.

## Reliability contract

- **Invariant / class:** `agent-session.provider-ownership` — one committed
  execution has one host-owned binding, and stale or foreign emitters cannot
  mutate it. `agent-session.launch-membership` — committed/adopted owners are
  visible before provider output without being interpreted as turn activity.
- **Failure source:** fresh launches bypassed the owner transaction, so rows
  appeared late or were absent. Manual discovery then paired a foreground
  command with pane-scoped hook metadata instead of proving both described the
  same process, allowing early/late or nested events to target the wrong root.
- **Oracle:** the focused production-path tests assert provider receives the
  binding env, the canonical owner result admits exactly one row, mismatched
  claims are suppressed, reservations resolve during promotion, exact emitter
  proof matches the foreground incarnation, nested providers fail closed, and
  complete versus incomplete inventories retain or retire in the correct scope.
- **Gate:** no dedicated blocking entry exists yet for this newly composed
  cross-host invariant; the changed-code quality gate and deterministic unit /
  provider-contract suites are the accepted experimental gate for this commit.
- **Provider/platform matrix:** local PTY, runtime/headless, daemon and renderer
  launch paths are covered. Manual discovery is covered for native POSIX PTYs
  and negotiated POSIX SSH relays. WSL guest inventory, Windows relay ancestry,
  multiplexer pane roots and non-PTY automation membership are accepted gaps.
  Mobile consumes the optional membership facet but final replica parity is a
  host-composition gap. No Electron UI validation was in this implementation
  task.
- **Performance budget:** the change adds no polling, timers, wake loops or
  broad repeated scans. Discovery reuses the execution host's bounded process
  snapshot once per inventory admission. Owner lookup stays bounded by
  `MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES`.
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
- Exact emitter/discovery production suite at implementation HEAD: 12 files,
  159 tests passed, 3 skipped.
- Inventory integration regression suite at implementation HEAD: 3 files, 26
  tests passed.
- Transport/spool/SSH auxiliary suite: 5 files, 51 tests passed, 2 skipped.
- Focused C5/C10 suite: 4 files, 31 tests passed (child first-event
  suppression, verified discovery validation/adoption/replacement, inventory
  admission and reconciliation forwarding).
- Agent-hook regression suite: 89 files, 926 tests passed, 9 skipped.
- Foundation suite: 7 files, 51 tests passed
- Provider/runtime suite: 10 files, 112 tests passed
- Status/relay suite: 15 files, 225 tests passed with one pre-existing expected failure
- Runtime/daemon suite: 9 files, 151 tests passed
- Relay/provider contract suite: 4 files, 63 tests passed
- Hook transport/status suite: 3 files, 52 tests passed

No Electron app was launched and no native-focus or visible-window validation
was attempted. Full end-to-end WSL/Windows/multiplexer/automation fixtures,
replica negotiation, and the remaining C1/C2/C3/C4/C6/C7 behavior are not
covered by this implementation commit.

## Remaining work and disposition

Commit `e30e6b769ce1fdad26ecc028e4a3c572f0f58e90` is the stable reusable C5/C10
implementation for dependent batches, not full closure of both architecture
plans. Dependents should consume
`owner.statusBinding` and `agentSessionEnsure` from implementation commits
`165851414dde2cf4801b5d60b60553e7cefc5cf9` and
`9adb2253c5d6a0cc0e5f29cd27bd0e94b0c9e895` and
`8b1d78d87ea5029d25539e929bad3685d355a641`, plus the exact-subject discovery
contract at `e30e6b769ce1fdad26ecc028e4a3c572f0f58e90`; they must not mint another
run or reservation. Full batch completion requires the explicit gaps in the
matrix, with fresh independent review and provider/platform QA before any PR or
merge.

### Bounded follow-up brief

The remaining work is anchored to `agent-status-triage-2026-09-14.html#plan-C5`
(host-side discovery for unlaunched agents, inherited child identity, and the
automation launch-site requirement) and `#plan-C10` (Windows/WSL and
multiplexer row-admission cases). It is not scheduled by this implementation
Run. A follow-up owner should keep the transaction and proof contract above and
add only the missing execution-host evidence:

1. **WSL:** negotiate an optional guest inventory proof containing the guest
   PTY root/incarnation, guest process parent chain and exact hook-emitter
   subject. Join it on the guest execution host; never compare a Windows PID to
   a guest PID or treat missing proof as `live`.
2. **Windows relay:** connect the existing Windows process table and job/ConPTY
   ownership evidence to relay discovery using PID plus creation time. Require
   exact foreground/emitter membership and preserve `unverifiable` when job or
   ancestry evidence is unavailable.
3. **tmux/screen:** resolve the active pane's PTY and child root on the execution
   host, then feed that bounded chain into the existing foreground/emitter
   comparison. Do not introduce a title, cwd or pane-label fallback.
4. **Detached automation:** make the automation dispatch path announce or adopt
   explicit parent/child execution membership through the canonical owner/store
   contract. Do not synthesize a terminal surface for cron or message-driven
   work.

Acceptance for that follow-up is an old/new capability matrix plus native,
WSL, Windows relay, multiplexer and detached-automation tests covering first
admission, child/foreign rejection, PID reuse, replacement, replay, delayed old
settlement and disconnect/contact loss. Absence of evidence must remain
`unverifiable`, and discovery bookkeeping must not gate the user action that
triggered it.
