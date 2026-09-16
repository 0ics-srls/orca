> **Fleet upgrade complete — 2026-09-13 00:27 UTC:** All19 targeted general-serving cells upgraded to the approved image and regional capability3. All38 health/ready checks passed; GCE groups stable; director inventory ready/general for all19. Final authenticated inspect [34727921841](https://github.com/stablyai/orca/actions/runs/34727921841) passed at selector230 / disabled control14; serving and rollback cohort0. Broader migration remains off. [Full rollout evidence and remaining gaps](./RELAY-FLEET-UPGRADE-STATUS.md). Older dated statements below are history.

> **Final production test snapshot — 2026-09-12 04:34 UTC:** User desktop migrated Asia C27→US C7 and completed cleanup. One completed migration, zero active/aborted, target reservations0. Durable migration disabled generation14; cohort0 restored on serving00610-huf and rollback00609-dur (workflow34673085225 passed). Latest CPU32.07%. Individual end-to-end test complete: user subsequently confirmed “it does work and connects faster now” on 2026-09-12. This is qualitative connection-speed evidence; broader release validation and numeric latency measurements remain open. [Exact commands, tests, incident history and results](./RELAY-REGION-CORRECTION-LIVE-STATUS.md).

> **2026-09-12 04:29 UTC:** User desktop migrated C27→C7 at04:25:57 UTC; one completed migration, zero active/aborted, target reservations0. Durable switch disabled again generation14 (34673003455); final cohort0 restore34673085225 in progress. Phone confirmation pending. See [live status](./RELAY-REGION-CORRECTION-LIVE-STATUS.md) for exact evidence and the polling fix deployed via#20203.

> **2026-09-12 03:49 UTC:** Both cell upgrades passed. Cohort-100 preparation encountered SQL CPU 88–94% before any migration enablement. Audited recovery 34671192604 passed: serving `00600-nab`, rollback `00599-bos`, cohort 0, durable rehome still disabled generation 12. CPU latest available sample 60.9%, recovery observation ongoing. Small disabled-polling regression fix is local and validated; enabled-load benchmark pending. No successful user migration is claimed.

> Current production snapshot: [2026-09-12 03:23 UTC live status](./RELAY-REGION-CORRECTION-LIVE-STATUS.md). Cloud/desktop and rollout PRs are merged; C27 upgrade passed, C7 replacement is in progress, cohort remains 0, and idle migration is not yet proven. Older pending-PR/no-deployment statements below are historical evidence.

# Relay region correction — implementation checklist

> **Scope: idle-only correction.** Superseded retention history is preserved in
> `.tmp/idle-cutover-review/checklist-history-before-final.md` and the backup branch.
> Follow [idle-cutover plan](RELAY-REGION-CORRECTION-IDLE-CUTOVER-PLAN.md).

## Idle-only implementation tracker

- [x] Resolve plan review findings and obtain Astra approval (revision 2).
- [x] Preserve pre-rescope revision on `relay-region-before-idle-implementation`.
- [x] Endpoint authentication and incarnation check: deterministic red/green.
- [x] Worker selects before cutover; busy deferral and lost reply tests: red/green.
- [x] Source barrier covers accepts, attaches, commands and control replacement (48 registry tests, including conflicting operation-ID authority tuples; red/green evidence in acceptance).
- [x] Constrained assignment commit and locked ambiguous-outcome reconciliation (11 PostgreSQL 16 tests on 55440, including both replacement orders and a lost commit reply).
- [x] Desktop removes live-retention handling, retains fresh decisions and fallback (53 focused desktop/compatibility tests; node typecheck passes).
- [x] Remove superseded cloud retention protocol/store/cleanup and obsolete tests. The legacy database capability column remains written as0 for existing schema compatibility; it enables no behavior.
- [x] Real two-cell transport: two clients, quiet connection, idle move, arrival race, and observed target-registration failure with ordinary recovery (3 tests pass).
- [x] Focused PostgreSQL transaction/concurrency checks on 55440 (11 passed).
- [x] Full local relevant cloud/desktop suites: 682 cloud tests with PostgreSQL,177 desktop relay tests,16 transport/compatibility tests.
- [x] Local pinned-wire compatibility, Docker SSH/folder continuity (7), types, lint and reliability manifest. Packaged/device/platform gates remain open.
- [x] Fifth Astra low implementation audit: APPROVE within the documented scope.
- [ ] Validate updated cloud/desktop PRs and fresh CI; capacity semantics now have regression coverage and documentation.

These are merge-readiness tasks. Device/package/platform and production rollout
requirements remain explicit gaps until independently evidenced.



Current transport disposition: **the replacement idle-only transport suite is green
(3 tests), but the PRs are not ready**. Local cloud/desktop verification, final implementation audit, SSH/folder evidence
and reliability docs are complete. PR updates, fresh CI and release evidence remain.
The full cloud suite passes682 tests with PostgreSQL16 and no skips; cloud typecheck passes. Final audit and remaining end-to-end/PR tasks are still open. Exact commands/results are at the top of the acceptance document. The original
live-retention rollback assertion is superseded by the approved product rescope;
these results do not claim that old design was repaired.

## Publication and release gates

- [x] Prepare separate cloud/desktop patches and concrete PR descriptions locally.
- [x] Reproduce and address old CI failures: fetch audit count and cloud test dependencies.
- [x] Authorization received; separate PRs #20105 (cloud) and #20106 (desktop) updated with idle-only scope.
- [ ] Verify exact-head CI.
- [ ] Packaged mixed-version desktop/mobile and physical-device lifecycle.
- [ ] Linux/Windows transport evidence, CI soak, bounded rollout and measured benefit.

No production mutation or deployment occurred. Local passing tests and audit approval
are not a claim that the current published PRs are ready or the feature is deployed.
The acceptance document lists commands, evidence scope and remaining gaps.

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

## Targeted serving-fleet upgrade completion — 2026-09-13 UTC

- [x] All19 general-serving cells upgraded; per-cell exact image/capability3, heartbeat, trust proof and general-admission restoration passed.
- [x] `python3 .tmp/fleet-final-inventory.py`:19/19 RUNNING and stable on approved digest with trust configured; passed00:25 UTC.
- [x] `python3 .tmp/fleet-final-observation.py`:38/38 health/ready endpoints,19/19 ready/general director inventory, current GCE instance IDs matched fresh runtime logs;0 active/awaiting receipt/registered regional migrations,1 completed/0 aborted over24h.
- [x] `gh workflow run cloud-operate-relay-production-rehome.yml -R stablyai/orca --ref main --json < .tmp/fleet-final-inspect-inputs.json`: run34727921841 succeeded; selector230, exact memberships, disabled control14. Director serving00610-huf and rollback00609-dur unchanged, cohort0 on both.
- [x] Final read-only telemetry: latest SQL CPU32.38%, five-minute auth5xx0/director non5035xx0; lock-wait series maxima4 and2 below20. These are bounded observations, not a guarantee of zero future errors.
- [ ] Broader regional migration enablement (separate work; remains disabled/cohort0).
- [ ] Broader packaged mixed-version/platform lifecycle coverage and numeric latency benefit remain open; individual real C27→C7 migration was confirmed by the user.

Exact run mapping, commands, failure/recovery history, and evidence limits are in the [acceptance record](RELAY-REGION-CORRECTION-ACCEPTANCE.md) and [fleet status](RELAY-FLEET-UPGRADE-STATUS.md). Original intermittent probe/404/409/lock-spike causes remain unproven. Local response-body cleanup is unmerged and not deployed. No new test suite was needed for these deployment/documentation-only continuation changes; earlier code fixes retain their recorded red/green and CI evidence.
