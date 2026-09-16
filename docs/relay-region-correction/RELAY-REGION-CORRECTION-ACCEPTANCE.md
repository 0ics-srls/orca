> **Fleet upgrade complete — 2026-09-13 00:27 UTC:** All19 targeted general-serving cells upgraded to the approved image and regional capability3. All38 health/ready checks passed; GCE groups stable; director inventory ready/general for all19. Final authenticated inspect [34727921841](https://github.com/stablyai/orca/actions/runs/34727921841) passed at selector230 / disabled control14; serving and rollback cohort0. Broader migration remains off. [Full rollout evidence and remaining gaps](./RELAY-FLEET-UPGRADE-STATUS.md). Older dated statements below are history.

> **Final production test snapshot — 2026-09-12 04:34 UTC:** User desktop migrated Asia C27→US C7 and completed cleanup. One completed migration, zero active/aborted, target reservations0. Durable migration disabled generation14; cohort0 restored on serving00610-huf and rollback00609-dur (workflow34673085225 passed). Latest CPU32.07%. Individual end-to-end test complete: user subsequently confirmed “it does work and connects faster now” on 2026-09-12. This is qualitative connection-speed evidence; broader release validation and numeric latency measurements remain open. [Exact commands, tests, incident history and results](./RELAY-REGION-CORRECTION-LIVE-STATUS.md).

> **2026-09-12 04:29 UTC:** User desktop migrated C27→C7 at04:25:57 UTC; one completed migration, zero active/aborted, target reservations0. Durable switch disabled again generation14 (34673003455); final cohort0 restore34673085225 in progress. Phone confirmation pending. See [live status](./RELAY-REGION-CORRECTION-LIVE-STATUS.md) for exact evidence and the polling fix deployed via#20203.

> **2026-09-12 03:49 UTC:** Both cell upgrades passed. Cohort-100 preparation encountered SQL CPU 88–94% before any migration enablement. Audited recovery 34671192604 passed: serving `00600-nab`, rollback `00599-bos`, cohort 0, durable rehome still disabled generation 12. CPU latest available sample 60.9%, recovery observation ongoing. Small disabled-polling regression fix is local and validated; enabled-load benchmark pending. No successful user migration is claimed.

> Current production snapshot: [2026-09-12 03:23 UTC live status](./RELAY-REGION-CORRECTION-LIVE-STATUS.md). Cloud/desktop and rollout PRs are merged; C27 upgrade passed, C7 replacement is in progress, cohort remains 0, and idle migration is not yet proven. Older pending-PR/no-deployment statements below are historical evidence.

# Idle regional correction acceptance

Updated 2026-09-11. Scope: [idle-cutover plan](RELAY-REGION-CORRECTION-IDLE-CUTOVER-PLAN.md).
Local implementation is based on main `74cc9b50390b481009b34823a35eee01a5b90e40`,
with uncommitted changes atop `08c0802089a9186cf48ce0d168cd87565bd92d65`.

**Local validation is green; cloud review is conditionally approved pending capacity evidence (now added). Published PRs still require fresh CI.**
Cloud PR #20105 and desktop PR #20106 carry the idle-only split; fresh CI must be checked at exact heads.
Their older CI is not evidence for this implementation. No commit, push, merge,
deployment, workflow dispatch or production mutation occurred in this continuation.

## What the implementation proves

The source permits optimization only when actual client sockets, splices, pending
connections and in-flight admission/control work are absent. It installs the local
gate before awaiting a constrained assignment transaction. Duplicate requests bind
exact authority; ambiguous database outcomes keep the source fenced until locked
reconciliation establishes the result. After commit, it releases the empty control
and uses ordinary reconnect and migration recovery. Emergency drains retain their
existing behavior. No retained-source protocol or restoration loop remains.

Three real TCP WebSocket scenarios join authenticated local HTTP dispatch, two
cells, the actual desktop origin pool, SQLite and an independent execution child:

1. Either connected device prevents movement; after both leave, target reconnect
   succeeds and the durable append-once mutation oracle shows no replay.
2. A racing arrival receives4409; a definite failed commit restores source admission.
3. The target control connection is actually attempted and fails; source activity
   is released and ordinary expiry recovery allows source epoch3 reconnect.

These use synthetic time and token verification. They do not prove physical mobile
background scheduling, production authentication/network behavior or user latency.

## Commands and results

Every test/app command uses `ORCA_BACKGROUND_LAUNCH=1`. Cloud commands run from
`cloud/apps/relay`; root commands run from this worktree. All logs below are under
`.tmp/idle-cutover-review/`.

| Scope | Command | Result / log |
| --- | --- | --- |
| Cloud | `ORCA_RELAY_TEST_POSTGRES_URL='postgresql://postgres@127.0.0.1:55440/postgres?options=-csearch_path%3Didle_full_root_20260911' ORCA_IDLE_REHOME_POSTGRES_URL='postgresql://postgres@127.0.0.1:55440/postgres' ORCA_REGION_CORRECTION_POSTGRES=1 pnpm exec vitest run --no-file-parallelism` |77 files /682 passed /zero skips; `cloud-full-postgres-idle.log` |
| Cloud | `pnpm run typecheck` | Passed; `cloud-typecheck-after-preview.log` |
| Cloud | `pnpm build` | Passed; `cloud-release-build-idle.log` |
| Root | `pnpm test src/main/runtime/relay` |20 files /177 passed; `desktop-relay-full-idle.log` |
| Root | `pnpm test tests/e2e/relay-region-correction.unit.test.ts tests/e2e/relay-region-compatibility.unit.test.ts` |16 passed; `transport-contract-cleanup.log` |
| Root | `pnpm test src/main/global-fetch-call-site-audit.test.ts tests/e2e/relay-region-correction.unit.test.ts` |4 passed after CI fixes; `ci-gaps-green.log` |
| Root | `pnpm tc:node` | Passed; `node-final-idle.log` |
| Root | `pnpm exec oxlint src/main/runtime/relay tests/e2e/relay-region-correction.unit.test.ts tests/e2e/relay-region-compatibility.unit.test.ts` | Passed; `desktop-lint-idle.log` |
| Root | `pnpm run check:code-quality:changed` | Passed,0 new findings across30 changed files; `code-quality-changed-idle.log` |
| Root | `pnpm run check:reliability-gates` |121 manifest gates passed; `reliability-idle.log` |
| Root | `ORCA_E2E_SSH_DOCKER=1 pnpm exec playwright test tests/e2e/ssh-docker-transport-drop-recovery.spec.ts tests/e2e/paired-remote-terminal-serve-restart-binding.spec.ts --config tests/playwright.config.ts --project electron-headless --workers=1` |7 passed after fresh build; `ssh-folder-idle.log` |
| Root | `node --test cloud/dev/scripts/deploy-relay-blue-green.test.mjs cloud/dev/scripts/read-relay-serving-regional-placement-version.test.mjs cloud/dev/scripts/relay-regional-rehome-workflow.test.mjs` |47 passed; `deployment-guards-idle.log` |

PostgreSQL16.15 reused the existing `orca-region-release-pg16` container on55440.
The suite used an isolated schema, dropped afterward (`cloud-full-postgres-cleanup.log`);
new concurrency tests create and clean independent schemas. No other PostgreSQL
port was used. Root oxlint ignores cloud; the configured cloud lint is TypeScript.

The seven background Electron checks cover paired folder-capable binding across
serve restart and six real Docker SSH recovery journeys: live pane, output bounds,
host-proven exit, repeated restarts, frozen-host silence and resumed input. They do
not exercise a physical phone-to-SSH regional cutover or packaged upgrade.

## Regression and review evidence

- Reconciliation: four cases fail against constant not-committed, then pass with
  locked authority checks (`reconciliation-{red,green}.log`).
- Registry: disabling pre-await admission accounting makes the arrival race fail;
  restoring it passes. Five conflicting operation-ID authority tuples fail before
  the identity fix, then all48 registry tests pass (`operation-tuple-{red,green}.log`).
- SQLite startup capability upgrade: red before upgrade logic;8 database tests pass
  afterward. Legacy controls default to not idle-capable.
- The commit placeholder negative control was run after implementation; it is
  counterfactual evidence, not a claim of chronological test-first development.
- Full PostgreSQL verification supersedes intermediate preview/legacy-test failures.
  An agent's earlier PostgreSQL safety-latch discrepancy was disproven in an
  isolated schema and explicitly withdrawn.
- Fifth GPT-6-astra low audit: **APPROVE within implementation scope**, no new blocker.
  Reviewed source barriers, exact duplicates, locked ambiguity and worker progress.
  Reviewer had migrated PostgreSQL tests, but did not author the core implementation.
  Ledger: `.tmp/idle-cutover-review/review-ledger.md`. No sixth cycle started.

## CI preparation and review artifacts

Old desktop CI failed on a stale global-fetch inventory count and missing `pg` for
the transport test. The count reproduces locally; the downstream catalog/probe
consumers already consume/cancel bodies, so the audited count is corrected.
The unit workflow installs locked cloud relay dependencies and builds their contracts.
From `cloud/`, both commands pass (`ci-relay-dependencies.log`):

- `npx --yes pnpm@10.24.0 --filter '@orca-cloud/relay...' install --frozen-lockfile --ignore-scripts`
- `npx --yes pnpm@10.24.0 --filter '@orca-cloud/relay^...' build`

Local split patches and draft bodies are in `.tmp/idle-cutover-review/`:
`cloud-idle.patch`, `desktop-idle.patch`, `cloud-pr-body.md`, `desktop-pr-body.md`.
`prepare-split.py` verifies ordered application against the stated main baseline;
`split-manifest.json` identifies the combined tree. The actual index/branches remain
unchanged. The HTML explainer is `.tmp/relay-region-explainer.html`; four stages,
failure toggle, light/dark mobile/desktop layout and browser-error checks pass.

## Capacity evidence added

The selector intentionally counts the moving host activity units from the source cell, then adds one assignment unit. PostgreSQL regression coverage passes for exact capacity and rejects one unit less; a counterfactual target-cell filter fails the same test.

## Remaining acceptance gaps

- Verify fresh CI for exact heads of PR #20105 and #20106.
- Packaged mixed-version desktop/mobile, physical-device lifecycle and platform
  transport remain unverified. Pinned wire tests are narrower evidence.
- CI soak and production RTT/interaction benefit remain unmeasured. Correction
  defaults off; deployment/enablement require the reviewed rollout procedure.
- Archive of intermediate/superseded evidence:
  `.tmp/idle-cutover-review/acceptance-history-before-final.md` and pre-rescope branch
  `relay-region-before-idle-implementation`. Earlier retention results do not prove
  the idle design or repair the superseded live-retention transport case.

## Production capability audit (2026-09-12 UTC)

- PR #20105 (merge `cd9aa43a2c76`) changed trusted relay runtime capability from 1 to 3; #20174 only updates rollout tooling. Earlier conversational claims otherwise were incorrect.
- Read-only GCE inspection: C27 `relay-c27-j5ff` has both rehome trust settings and configured relay image `sha256:c844f77d8ca19469fd61d0a1d958717c5554287009cfdb3664948f276980fbe2`. C7 `relay-c7-bwjc` also has both settings, with image `sha256:4916ed676d8389f694a648e750f1112d9002d68c84a1e0c7af828d5af129de62`. These are configured images, not authenticated runtime-status proof. No evidence supports the previous guess that C27 lacks trust configuration.
- #20174 review found two valid blockers: parser rejection of 3 and a trust-probe condition restricted to 1. Fixed both; parser regression failed before the fix (`.tmp/protocol3-parser-red.log`).
- `ORCA_BACKGROUND_LAUNCH=1 node --test cloud/dev/scripts/validate-relay-capacity-plan.test.mjs cloud/dev/scripts/verify-relay-capacity-transition.test.mjs cloud/dev/scripts/relay-same-cap-script-census.test.mjs`: 73 passed, 0 failed (`.tmp/protocol3-rollout-green.log`).
- Refreshed read-only Asia selector inspection: workflow run 34664574767.
- Remaining: authenticated live capability proof; exact-head CI/review; compatible source and destination canaries; migration enable/observe/disable test. No production mutation or successful migration is claimed by this audit.

- Follow-up PR #20174 merged as `113e58f34e53d7496b0473346dbc209ff0a805be` after all exact-head CI checks passed (`66f61280972c`, Cloud Verify run 34664745443). Independent Astra review found no rollout/rollback blocker at `eecbe85a2d20`; the subsequent change only adds protocol-3 plan coverage across every rollout cell.
- Full read-only GCE configuration inventory: all 19 approved serving cells have trust configured; the 16 US cells use `4916ed676d83…`, and C27–C29 use `c844f77d8ca1…`. None uses target `d6189b7118b5…`. Legacy/migration-only cells have separate configurations and are outside this rollout.
- Live director revision `orca-cloud-relay-00590-ruy` serves 100% traffic, target digest `d6189b7118b5…`, cohort 0. Fresh selector inspect 34664574767 succeeded at generation 192. Production read-only pre-drain monitor 34664655626 and durable-control inspect 34664779163 precede any cell mutation.
- Root cause of the readiness-reporting gap: #20105 shipped cell-side idle behavior and capability advertisement changes, but the rollout checklist did not require proving deployed source/target runtimes, and the same-cap workflow still accepted only 0/1. Director deployment was incorrectly treated as sufficient cloud readiness. Earlier synthetic tests and passing script tests did not cover the protocol-3 CLI path; the new parser and plan regression cases cover that omission.

- Monitor 34664655626 succeeded with 16 samples, no failures and no frozen gate, completed `2026-09-12T01:38:50.066Z`. Durable inspect 34664779163 succeeded: control generation 12 disabled, selector generation 192. C27 single-cell canary dispatched as 34665504551 with target `d6189b7118b5…`/protocol 3 and rollback `c844f77d8ca1…`/protocol 1. Dispatch is not proof of mutation or successful rollout; result pending. User confirmed no mobile Orca apps in use.

- C27 canary 34665504551 failed closed at monitor-evidence provenance, before authentication/isolation/drain: the monitor had been sealed before #20174 changed rollout workflow/validator code. This was operator sequencing error, not a cell health failure. No cell mutation occurred. A fresh monitor must run after the tooling merge; do not reuse 34664655626 for rollout.

- Artifact Registry tag lookup binds configured US digest `4916ed676d83…` to source `61b09b7a0257…`, and Asia digest `c844f77d8ca1…` to `9c8f4c398c3f…`. Both source snapshots advertise 1 with both trust settings, otherwise 0. This supports expected predecessor protocol 1 for the 19 configured serving cells; the rollout must still authenticate live runtime-status before mutation. Replacement post-merge monitor: 34665651289.

- Post-merge monitor 34665651289 passed: 16 samples, no failures, no frozen gate, completed `2026-09-12T01:59:08.424Z`. Fresh C27 canary retry: 34666416405, same exact target/rollback digests and generations. Result pending; cohort and durable rehome remain disabled.

- C27 retry 34666416405 also failed before production operations: same-cap requires `--required-migration-policy strict`, whereas monitor 34665651289 used `capacity-transition`. This was a second operator-input error. Local read-only replay of `verifyDryRunAuthority` with the recorded original failure time accepted that artifact for `capacity-transition` and rejected it for `strict`, isolating the cause from freshness/provenance. No artifact was edited or reused for mutation. Correct strict monitor (both source/capacity scope `none`) dispatched as 34666641072. Any future same-cap dispatch must consume strict evidence.

- C27 canary 34667399188 passed cell rollout and sealing: predecessor verified at 02:23:44Z; restart-safe drain at 02:29:21Z; target image/heartbeat at 02:39:40Z; authenticated trust proof passed; general admission restored at selector generation **194** at 02:39:44Z. Final general-state verification passed at 02:39:46Z. Runtime capability 3 was checked against the exact target digest by the workflow.
- Independent evidence: GCE replacement metadata carries target digest `d6189b7118b5…`; runtime sample 02:40:18Z shows 103 controls, 1 splice, 0 SQL failures. User-digest assignment log 02:40:15Z still points to C27. Thus source rollout succeeded, but no regional migration to the US has occurred. Next: compatible US destination canary, eligibility, temporary enable/observe/disable.

- US pre-canary strict monitor 34668389687 froze after nine samples at 02:50:56Z on C17 `/health` and `/ready` active-probe failures. No US cell mutation was dispatched. Subsequent public checks both returned 200/ok twice, GCE C17 was HEALTHY/RUNNING with currentAction NONE, and recent runtime samples had zero SQL failures. Probe-failure cause remains unconfirmed; failed evidence is not reusable. Replacement strict monitor 34668859631 started at selector 194.

- Replacement US strict monitor 34668859631 passed with 16 samples and no failures at 03:08:37.249Z; local `verifyDryRunAuthority` accepted it for strict policy at current time. C7 single-cell canary 34669591505 dispatched with target `d6189b7118b5…`/3, rollback `4916ed676d83…`/1, selector 194, disabled control 12. Result pending; no migration enablement yet.

### Remaining serving fleet (2026-09-12, in progress)

User authorized upgrading the remaining 17 general-serving cells; C7/C27 are already complete and will not be restarted. Migration stays disabled at control generation 14 and cohort 0. See [fleet upgrade status](RELAY-FLEET-UPGRADE-STATUS.md) for inventory, waves, and evidence.

Canary-authority reuse fix #20214 merged with 29 focused tests and 20 workflow tests passing. Monitoring adjustment #20238 merged as `1a9a5f9bc720bebd06a5dd190a4ea0000e59ccb4`, after 96 relay-ops tests, typecheck, Cloud Verify 34674803332 and repository verify passed. Astra low found no blockers. Three preflights stopped before mutations on sparse director PostgreSQL connection-timeout 500s; the monitor now permits up to three non-503 director errors per five-minute telemetry window and freezes at four, retaining auth zero-tolerance and other gates. This is an operational allowance, not resolution of those background errors. Fresh strict monitor 34675122903 is running; the remaining fleet is not yet upgraded.

C8 canary 34675827674 completed successfully at 05:55 UTC: exact target image/capability 3, new incarnation, trust proof, heartbeat, and restored general admission passed. Selector is now 198; durable migration remains disabled at generation 14. Completed serving cells: C7/C8/C27; 16 remain. Next shared strict preflight 34676800738 covers the sequential C9/C10/C13/C14 batch.

Speed review: Astra reviewed parallel monitoring and larger sequential batches. Current shared locks and exact selector evidence prevent simply overlapping monitors. Increasing batch size would invalidate the new canary and require another, saving approximately one 15-minute window before engineering/CI costs. Continue existing four-cell batches with no additional manual holds. C8 drain took about nine minutes; infrastructure replacement and verification took about nine minutes.

## Completed serving-fleet rollout — 2026-09-13 UTC

All19 approved general-serving cells now run cell image `sha256:d6189b7118b5cc0cf82942c566db392f9ce98a4abeb06044a6df87d4e275a47d`. Each successful cell workflow checked regional capability3, exact image, fresh heartbeat, trust proof, and restored general admission. Legacy existing-only cells and migration-only C17/C18 were outside this upgrade scope.

| Cells | Successful deployment/recovery evidence |
| --- | --- |
| C27 | [34667399188](https://github.com/stablyai/orca/actions/runs/34667399188) |
| C7 | [34669591505](https://github.com/stablyai/orca/actions/runs/34669591505) |
| C8 | [34675827674](https://github.com/stablyai/orca/actions/runs/34675827674) |
| C9/C10/C13 | Successful cell jobs in partial batch [34677494340](https://github.com/stablyai/orca/actions/runs/34677494340) |
| C14 | [34711425632](https://github.com/stablyai/orca/actions/runs/34711425632); failed lock-release job alone rerun, cell job not replayed |
| C15 | Same-image recovery/resume [34714953897](https://github.com/stablyai/orca/actions/runs/34714953897) |
| C16 | [34716074728](https://github.com/stablyai/orca/actions/runs/34716074728) |
| C19/C20/C21/C22 | [34717662902](https://github.com/stablyai/orca/actions/runs/34717662902) |
| C23/C24/C25 | Successful cell jobs in partial batch [34721211632](https://github.com/stablyai/orca/actions/runs/34721211632) |
| C26 | [34724078791](https://github.com/stablyai/orca/actions/runs/34724078791) |
| C28 | [34725589509](https://github.com/stablyai/orca/actions/runs/34725589509) |
| C29 | [34727117734](https://github.com/stablyai/orca/actions/runs/34727117734) |

Final fresh strict preflights: C26 [34723357782](https://github.com/stablyai/orca/actions/runs/34723357782), C28 [34724869829](https://github.com/stablyai/orca/actions/runs/34724869829), C29 [34726456185](https://github.com/stablyai/orca/actions/runs/34726456185); all succeeded. C26's first attempt stopped before isolation on lock waiters26>20. No threshold was relaxed; the successful continuation used fresh evidence and did not replay C23–C25.

Final read commands from this worktree:

```sh
python3 .tmp/fleet-final-inventory.py
python3 .tmp/fleet-final-observation.py
python3 .tmp/rehome-sql-cpu-read.py
python3 .tmp/fleet-auth-errors-read.py
python3 .tmp/fleet-director-errors-read.py
python3 .tmp/fleet-lock-waits-read.py
gh workflow run cloud-operate-relay-production-rehome.yml -R stablyai/orca --ref main --json < .tmp/fleet-final-inspect-inputs.json
```

At00:25 UTC:19/19 GCE instances RUNNING, groups stable, configured target digest and trust;38/38 public health/ready checks passed; director inventory19/19 ready/general; fresh runtime log instance IDs matched current GCE IDs. These are complementary configuration/health/log checks, not a new simultaneous authenticated protocol snapshot; exact runtime capability and trust were proven by the per-cell workflows above. Final local inventory's first regex filter crashed the local gcloud parser; a simpler prefix filter plus exact local cell selection succeeded without production mutation.

Director remains `orca-cloud-relay-00610-huf` at100% traffic; rollback `orca-cloud-relay-00609-dur`. Both retain digest `sha256:fba845b47fcd5e7978c8d3b8fd7e10940051696a614a5ce0d4c0e5af28e804c3` and cohort0. Regional inventory:0 active/awaiting receipt/target registered,1 completed,0 aborted over24h. Ordinary assignment reservations are nonzero and must not be described as zero migration work. Latest SQL CPU32.38%, recent32.38–33.66%; checked five-minute auth5xx0 and director non5035xx0. Lock-wait series4 and2, below20. Latest per-cell runtime samples:SQL failure deltas0, queued bytes0, total database-pool waiters3.

Remaining gaps: fleet upgrade completion does not enable broader regional migration. The durable switch and cohort remain off. Broader enablement is separate; packaged mixed-version/platform lifecycle coverage and numeric latency benefit remain narrower than fleet rollout evidence. The user-confirmed C27→C7 migration remains the real personal end-to-end result. Original intermittent probe failures, C14's404, C15's409, and C26's lock-spike cause are not conclusively diagnosed. The local response-body cleanup in `resource-inventory.ts` and its tests is unmerged and was not deployed. No arbitrary post-rollout soak was added.

Authenticated final inspect [34727921841](https://github.com/stablyai/orca/actions/runs/34727921841) succeeded: exact selector230/canonical memberships and disabled control14, verified at00:26:43 UTC; fresh regional inventory at00:26:45 had0 active/awaiting receipt/target registered,1 completed,0 aborted. This closes the targeted fleet-upgrade task.
