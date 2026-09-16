# Relay regional rehome rollout status

Updated: 2026-09-16

## Handoff continuation — 2026-09-16

Canary remains **blocked**. Generation `14` must stay disabled; no pool-canary apply,
rollback, regional-rehome enablement, Terraform mutation, or manual GCP mutation was
dispatched.

### Fresh read-only access and evidence

- The dated monitor run `34999651050` remains the last sealed 15-minute monitor evidence
  (`generation=232`, 16 green samples). It was not reused for a canary dispatch.
- A workflow-identity candidate audit was dispatched as `35058021344` for c27/c28. It
  failed before emitting an audit record because c27's served runtime did not match the
  reviewed Terraform topology (reviewed c27 template is `sha256:5aedbca5…`; the fresh
  handoff inventory bound the live c27 instance to `sha256:e74357cc…`). No production
  mutation occurred and the rollout lease was released.
- A second read-only candidate audit, `35058119624`, succeeded for c4/c5. Its workflow
  identity verified both cells ready with fresh heartbeats and reported assignments `665`
  and `232`, respectively, with zero in-progress migration rows. That audit does not emit
  the selector generation or full membership, so it is not sufficient to freshly confirm
  generation `232`.
- Local impersonation of the monitor service account still cannot mint the required admin
  identity token. Therefore `/v1/admin/admission-selector/status`, runtime-status, and
  regional-rehome-control cannot be treated as fresh local-authoritative reads; the known
  direct path remains `401`/token-unavailable.
- A fresh local Compute read at `2026-09-16T05:11Z` found exactly one c27 instance
  (`relay-c27-j5ff`) in `RUNNING` state. Its MIG was stable with `currentActions.none=1`
  and template `orca-cloud-relay-gce-c27-20260915004322801500000001`; startup metadata
  still reports pool `10`, hard cap `3000`, unobserved bound `60`, and image prefix
  `sha256:e74357cc…`. This confirms the instance binding and predecessor pool, but does not
  replace the missing workflow-identity runtime/rehome/selector read.
- The local user's read-only Cloud Monitoring API access is working. The supported query
  is `cloudsql.googleapis.com/database/postgresql/backends_in_wait` filtered by
  `metric.label."wait_event_type" = "Lock"`; the API returns `timeSeries[].points[]`.
  A read-only 10-minute sample ending at `2026-09-16T05:09:22Z` observed total-backend
  maximum `106` and lock-wait maximum `8`. This is not a workflow-sealed one-minute
  canary input. A 60-second query can return no points at an arbitrary alignment boundary,
  so no authoritative one-minute maximum was supplied to a canary dispatch.
- A later two-minute local read ending at `2026-09-16T05:37:15Z` returned one aligned
  sample with maxima `97` total backends and `5` lock-waiting backends. It is likewise
  diagnostic only until captured by the workflow identity.

### Implementation checks

- Added explicit Cloud Monitoring response-shape parsing coverage for `timeSeries`/`points`
  and the alternate `timeSeriesData`/`point` shape in
  `cloud/dev/scripts/verify-relay-pool-cloud-sql-headroom.test.mjs`.
- The workflow headroom read now includes a two-minute lookback so one-minute aligned samples
  are not lost to Monitoring's current-bucket lag; the validator still compares the maximum
  of those one-minute buckets.
- The read-only candidate audit now emits its inspected selector generation and normalized
  membership alongside aggregate cell/migration state, so the next deployed audit can provide
  the missing selector snapshot without accepting an expected generation first.
- Focused Node test command passed **71/71** across the candidate-audit, pool-canary,
  observation, capacity-plan, wave, and workflow-contract checks.
- `actionlint` passed for both same-cap workflows after ignoring only the repository's
  pre-existing custom `blacksmith-*` runner-label warning; `oxfmt --check` and
  `git diff --check` passed.

### Next action

Deploy/run the updated read-only audit so it publishes the exact selector generation and
membership, pair that with the durable rehome-control `inspect`, then capture a workflow-owned one-minute
`num_backends` and lock-filtered `backends_in_wait` maximum. Only after those values are
freshly sealed may a read-only 15-minute monitor dry-run be dispatched. Do not dispatch with
generation `232` until that selector snapshot is obtained; leave the canary and regional
rehome disabled while the admin-token/selector and authoritative metric-capture gaps remain.

## Active four-step execution — 2026-09-14

User authorized driving all four steps through targeted fix deployment and validation.
This is execution authorization, not a request for another proposal. Preserve the10%
canary scope and owning workflows; do not apply the speculative compression plan.

- [x] 1. Measure user impact: failed/recovered renewals, connection failures, session drops,
  query-failure denominators, and contemporaneous healthy-vs-stall comparisons.
- [ ] 2. Identify and reproduce the initiating contention mechanism with independent signals.
- [x] 3. Implement and validate the targeted auth cleanup correction (PR #485).
  This corrects one proven contributor; contention outside cleanup remains unexplained.
- [ ] 4. Deploy a bounded reversible change through its owning workflow, verify sustained
  improvement, then fresh-gate the approved10% canary and observe at least5 NEW completions.

Record exact baseline, candidate, validations, immutable deploy/rollback identifiers,
observed results, and any real blocker under each step. Do not mark a step complete on
hypothesis alone. No operator action is currently required.

## Current decision — 2026-09-14 23:40 UTC

- Rehome remains disabled at durable generation 14; configured cohort 10%, rate 10 hosts/min.
- Auth cleanup correction deployed through workflows 34907957915 and 34908260013.
  Both proofs passed: 2,000 deletions in 0.578 s and 20,000 in 68.497 s; unchanged retention.
  Independent scan reads per examined row fell about 30× in the measured samples.
- Strict 15-minute safety monitor 34908710322 PASSED: 16 samples, no failures.
  Immediate rehome preview still reports database pool pressure; enablement is NO-GO.
  Zero new migrations; no enablement performed.
- No new canary completions. Current authorization covers a10% canary, not a100% expansion.
- Operator access works via Cloud Shell and the monitor identity; no access action needed.
- User requested a stronger investigation before a database decision. Compression trial is
  ON HOLD, no approval pending and no database flag applied. The saved plan is not authority.
- Historical comparison shows a recurring problem under increased traffic, not a new
  deterioration in the last few hours. See the baseline results at the end of this tracker.
- Enablement remains NO-GO pending required fresh safety evidence; earlier status below
  is historical and superseded by these findings.

## Initial completed work (historical)

- Cloud and desktop implementation PRs landed.
- Serving relay fleet was upgraded to protocol 3.
- A real desktop migration was exercised successfully and produced faster connections.
- Last verified control state (workflow run `34727921841`): selector generation `230`; control generation `14`; regional rehome cohort `0` (disabled).

## Step 1: production preflight

Status: **pending fresh read-only verification**.

The intended preflight must verify, through the audited workflow/read paths:

- serving and selector-rollback director revisions and immutable image digests;
- selector generation and exact cell memberships;
- all target cells healthy and reporting protocol 3;
- durable rehome control generation, enabled/cohort state, and no stale leases;
- recent migration, reconnect, database, and director error aggregates.

The prior verified inputs are preserved in `.tmp/fleet-final-inspect-inputs.json`. A fresh `gcloud` read was attempted, but ADC currently requires reauthentication again (`Reauthentication failed`), so no new production conclusion is being claimed.

## Remaining rollout

1. Complete the fresh preflight above.
2. Run the audited monitor dry-run and retain its run ID/attempt as enable evidence.
3. Enable a small cohort (recommended 10%) at the existing global rate of 10 hosts/minute.
4. Observe completed migrations, reconnect success, stuck/failed handoffs, database errors, and latency for roughly 30 minutes.
5. Raise cohort to 100% only if the signals remain healthy; keep the rate limit in place.
6. Continue monitoring and pause/disable new migrations if persistent failures appear. Completed migrations require the recovery path if rollback is needed.

## Operational constraints

- Use `.github/workflows/cloud-operate-relay-production-rehome.yml`; do not mutate production with generic `gcloud` commands.
- Capture exact pre-state and post-state for every enablement.
- Cohort controls eligibility; rate-per-minute controls migration pace.
- Updated desktop builds and an eligible idle relay session are required for a host to migrate.

## Fresh preflight result

Completed successfully via GitHub Actions run [34874545259](https://github.com/stablyai/orca/actions/runs/34874545259) at 2026-09-14 17:26 UTC.

- Serving and rollback director identity/image checks passed.
- Selector generation: `230`.
- Memberships exactly matched the supplied expected sets: existing-only 8, migration-only 2, general 19.
- Durable control generation: `14`.
- Regional rehome: **disabled** (`enabled=false`).
- Configured rate: `10` hosts/minute.
- No mutation steps ran.

Step 1 is complete. The next gated action is a fresh monitor dry-run, followed by a controlled initial enablement.

## Monitor dry-run result

Run [34875576865](https://github.com/stablyai/orca/actions/runs/34875576865) completed 2026-09-14 17:49 UTC with **failure**. The 15-minute read-only monitor collected 15 samples and froze on the final checkpoint.

The first checkpoints were green. The final checkpoint reported active-probe health/ready failures for cells `production-gce-c4`, `production-gce-c5`, `production-gce-c17`, `production-gce-c18`, `production-gce-c19`, `production-gce-c23`, and `production-gce-c27` (observed `0`, required `1`). No enablement is authorized until these are explained and the monitor passes.

The private evidence artifact is `relay-monitor-dry-run-34875576865-1`; its state records the exact failure list. This is a safety-gate failure, not evidence that rehome itself caused an incident.

## Follow-up investigation

Fresh runtime metrics show the monitor failures are mixed:

- `c4`, `c5`, `c17`, and `c18` are running GCE instances but latest metrics show `totalConnections=0` and `controls=0`. This may be intentional for empty/migration-only cells, but it means `/health` and `/ready` cannot be dismissed without checking the cell admission/runtime contract.
- `c19` and `c27` have active traffic but elevated SQL failure deltas (7 and 57 respectively in the latest samples); `c29` also shows 64 SQL failures. These are concrete database/runtime stress signals.
- `c23` has active traffic and no SQL failures in the latest metrics, so its probe failure may be transient or endpoint-path-specific.

Conclusion: the dry-run failure is not safe to override. Some failures may be expected for empty cells and one may be probe noise, but the simultaneous SQL errors and zero-control cells require targeted cell readiness/admission verification before enablement.

## Independent live recheck (2026-09-14 18:53 UTC)

The production GCE runtime stream was queried independently with the required
`jsonPayload.event="orca_relay_runtime_metrics"` filter. It shows a stable, coherent split:

- `c4`, `c5`, `c17`, and `c18`: `totalConnections=0`, `controls=0`, `sqlFailuresDelta=0`.
  These match the selector's intentional `existing-only` (`c4`,`c5`) and `migration-only`
  (`c17`,`c18`) memberships and are empty by design; they are not evidence of a live traffic
  outage. They still cannot satisfy the monitor's active probe requirement until the monitor
  contract explicitly excludes intentional empty cells or the probe path is corrected.
- `c19`, `c27`, and `c29`: active traffic and controls (latest approximately 599/571,
  975/936, and 988/956 respectively) with `sqlFailuresDelta=0` across the latest samples.
  The earlier deltas (7, 57, and 64) have cleared; this is independent evidence of recovery,
  while latency remains observable (roughly 54 ms, 340 ms, and 866 ms in the latest samples).
- `c23`: active runtime was previously observed with no SQL failures; no evidence currently
  indicates a persistent cell fault. Its failed probe remains unexplained/transient until a
  fresh probe confirms recovery.

Decision: **enablement remains unsafe and is not authorized**. The monitor failure is partly
expected empty-cell behavior, but the strict monitor still fails and has an unresolved c23
probe plus a recent SQL-error episode. Concrete next action is a new read-only monitor dry-run
after verifying the monitor's empty-cell probe policy and obtaining fresh `/health` and `/ready`
samples for c19/c23/c27/c29 (separated by the readiness cache window). Enable only after a
15-minute pass with zero active-probe failures and the required database-error bar; otherwise
leave rehome disabled and escalate the monitor contract/runtime fault through its owning workflow.

## Follow-up dry-run

Dispatched read-only monitor run [34883688971](https://github.com/stablyai/orca/actions/runs/34883688971) at 2026-09-14 18:54 UTC using selector generation 230 and the exact memberships above. It is still running through the 15-minute probe window; no enablement or other production mutation was performed.

## Follow-up dry-run result (2026-09-14)

Run [34883688971](https://github.com/stablyai/orca/actions/runs/34883688971) passed after 16 samples over the full 15-minute window. Checkpoints at minutes 0, 5, and 15 were green with `failures=[]`; the previously failing active probes, including c23, recovered. Selector generation remained 230 and no mutation ran.

This satisfies the monitor safety gate. Rehome is still disabled. Recommended next action is an audited, small-cohort enablement (10%) through `cloud-operate-relay-production-rehome.yml`, preceded by capturing fresh control state and immutable director identities, then a 30-minute observation with rollback/disable criteria. Do not use generic gcloud mutation commands.

## 10% enablement dispatched

Enable workflow [34886036201](https://github.com/stablyai/orca/actions/runs/34886036201) dispatched with the passing dry-run evidence `34883688971` and fixed rate 10 hosts/minute. It is waiting to start; mutation has not yet been confirmed. Follow-up monitoring must begin immediately after the workflow reports success.

## Correction and controlled rollout plan — 2026-09-14 19:31 UTC

Enable run 34886036201 FAILED at input validation before authentication; every mutation
step was skipped. `not-before=0` violates enable's positive-epoch requirement. The prior
“10% enablement dispatched” label was incorrect: this workflow sets the durable switch
and rate, not the cohort. Live revision 00610-huf still explicitly has cohort 0.

Pre-state: 100% director traffic on 00610-huf, rollback tag on 00609-dur; serving
image fba845b47fcd5e7978c8d3b8fd7e10940051696a614a5ce0d4c0e5af28e804c3.
19:30 inventory confirms active/awaitingReceipt/targetRegistered/completed24h/aborted24h
all zero. Older cumulative outcome rows must not be counted as new canary successes.
Fresh inspect dispatched: 34887400484.

Authorized sequence: verify disabled generation 14; same-image director workflow with
explicit cohort 10; verify serving/rollback cohort and health; fresh 15-minute strict
monitor; enable with valid epoch and fresh evidence; observe until at least five NEW
completed moves. Never raise cohort beyond 10. If any new abort, authority/recovery
error, safety-disable event, or strict monitor breach occurs, stop new moves through
the audited disable workflow and investigate before retrying. Poll at most 60s apart;
cloud log ingestion and workflow queueing add latency, so instantaneous detection or
stopping is not guaranteed. Local monitor impersonation is denied (including the
narrow generateIdToken path); use workflow admin reads plus aggregate live logs.

19:32 inspect 34887400484 passed: selector 230, disabled generation 14, zero active and
zero completed/aborted24h. Same-image cohort=10 director rollout: 34887580936.
All c4/c5/c17/c18/c19/c23/c27/c29 health and ready probes independently returned 200.
Correction: empty cells are expected to have zero controls, NOT to fail health/ready.
There is no evidence supporting bypassing their probes.
The earlier 16,063 controls estimate double-counted repeated samples. A fresh
latest-per-cell snapshot totals 12,031 controls across 23 cells; neither this number
nor the earlier one measures distinct users or eligible updated desktops.

19:38 director rollout 34887580936 PASSED: serving 00615-zin (100% traffic),
rollback 00614-moy, both same fba845 digest and explicit cohort 10. Native health
smoke passed. Artifact tag binds image to source f7238ce4693c450ee06976575f01f1f168876a51;
its idle rehome worker matches the reviewed implementation.
19:39 dry-run 34888154429 froze at first sample solely on director.instances=9 > 6.
Independent Monitoring at 19:40 confirms predecessor=0, serving=5, rollback=1.
Fresh replacement dry-run 34888362107 dispatched after convergence.
24h observation read independently passed all 24 hourly buckets (14,394 samples).

19:48 replacement monitor 34888362107 failed after 8 samples: c5/c9/c13 health/ready
zero, corroborated by independent fleet SQL failures (526 across a two-minute
window), pool waiters up to 71 and ~2002ms waits. No rehome attempts occurred.
Postgres window 19:47:30–19:49:00 contained 430 FATAL “connection to client lost”,
33 cannot-obtain-lock and 5 lock-timeout errors. Causal direction is unproven.
The specific shared auth-db was not CPU/memory/backend saturated: around 47–52%
CPU, 44.6% memory and 104–118 backends. Do not confuse sums across auth-db and
push-db with the relay SQL instance.
19:51:55 fresh runtime recovered: 23 cells, zero SQL failures over 2m, max pool
waiters 9, max wait 185ms, zero recovery failures and no fresh rehome error events.
Keep durable rehome off; require a new complete gate after this interruption.

Latest fresh monitor: 34889504657, started collecting at approximately 19:54 UTC.
No enable has been retried. Narrow monitor ID-token grant requested separately
for live preview reads; pending user reply, no IAM changes made.

## Final enablement blocker — recurring database disruption

19:59 independent snapshot caught a SECOND fleet-wide event: 397 SQL failures
over the two-minute window, max pool waiters 67, max pool wait 2002ms, two
regional-rehome polling failures, still zero active/completed/aborted24h moves.
This repeated approximately ten minutes after the first event. The agent caught
both through independent polling while the durable gate was off. This is not
a migration-induced failure. The underlying cause is not proven: SQL client
disconnections and lock contention are observed, not yet a causal diagnosis.

Decision: NO-GO for enablement. Stop retrying monitor gates simply to obtain a
green sample between recurring disruptions. Cancel requested for own read-only
monitor 34889504657; no enable retry or drain performed. Final read-only control
inspection dispatched as 34890233052. Production cohort is configured 10 on
serving/rollback, but durable rehome must remain disabled until this is resolved.

Next action: complete shared-SQL connection/lock incident investigation, obtain
direct aggregate preview/safety reads, then require fresh sustained safety
evidence before the already-authorized 10% enable. Narrow IAM read-access request
remains pending; no IAM change made. No five-new-completion claim is justified.

Final read-only inspection 34890233052 PASSED (20:02 UTC). No further enable
attempt was made. Monitor 34889504657 is cancelled, so no workflow holds the
production lock for this observation task.

## Approved direct monitor access — 2026-09-14 20:06 UTC

User approved the narrow grant. Added only roles/iam.serviceAccountOpenIdTokenCreator
to user:jinwoo@stably.ai on orca-cloud-gha-monitor@onorca-cloud.iam.gserviceaccount.com.
Verified the binding and successful generateIdToken + direct admin reads after IAM
propagation. Tokens remained process-local and were neither printed nor saved.

Live control: disabled generation14; cohort10; open migrations0; available slots8;
globalSafetyFailure=null. Preview at 20:06 reports 126 eligible host assignments
in cohort10: 123 US→Asia and3 Asia→US. Exclusions: no-verified-decision49303,
inconclusive-or-insufficient-improvement7899, outside-cohort1732,
source-control-unsupported-or-inactive72, expired10. Counts are host assignments,
not distinct users. Outside-cohort rows have not passed every later check, so do
not extrapolate a 100% count. Cumulative outcomes139 completed/1 aborted are
historical, not canary successes; recent inventory remains zero.

Follow-up exclusions: the shared SQL disk is already250GB PD_SSD with max_wal_size
16384. Checkpoints are timed at five-minute intervals with recent syncs0.062–0.093s,
so the prior small-disk/WAL-loop incident is not established here. NAT dropped-packet
metrics contained12 present series across US/Asia, all zero during19:45–20:09;
there is no evidence for a NAT capacity mutation. The20:08 checkpoint did not
reproduce the large spike in the immediate observed samples.

## Authoritative safety blocker confirmed with new access

20:11 direct preview returned globalSafetyFailure=database_pool_pressure,
global-safety-blocked124 and source-unclean2; open migrations0, durable generation14
still disabled. The earlier126 eligible figure was a momentary advisory snapshot,
not a guarantee that126 hosts can move while pressure recurs.

Query Insights perquery lock_time (19:46–20:01,300 series, no truncated page)
points to query hash297765224517183493, renewPostgresControlActivity: it checks
assignment/migration authority and renews control activity leases. Its lightweight
lock-time delta was228175882 (provider raw units), with peak133614783 in19:58.
This identifies an affected query, NOT the lock holder or root cause. Sampled
backend waits include WALWrite lightweight locks (peak15 at20:00), WalSync I/O,
and low transactionid lock counts. A higher-resolution backend wait trace is
needed to distinguish WAL durability stalls from query-driven contention.

Disk rates19:45–20:12 peaked at946 write ops/s and7.63MB/s; the affected minutes
were lower. Alongside the250GB disk and fast checkpoint syncs, this does not
justify an unreviewed disk resize. No production SQL, capacity, NAT or safety
threshold changes were made. Do not change the renewal query solely because
it accumulates wait time: waiting does not identify the blocker.

## Next diagnostic and concrete access blocker — 20:15 UTC

Prepared `.tmp/rehome-postgres-wait-sample.cjs`: one Cloud SQL proxy bound only to
127.0.0.1 on an ephemeral port; credentials fetched into process memory; PostgreSQL
connection configured default_transaction_read_only=on, statement_timeout=2000ms,
lock_timeout=500ms; aggregate pg_stat_activity/pg_blocking_pids only. Proxy and
client are cleaned up in finally. No query text, host identity, or credentials
are printed. No production SQL query actually ran: the proxy's upstream TCP
connection to35.188.82.89:3307 timed out even with a30s connection window.
IAM token generation and HTTPS admin reads succeed, so the new role works.
This is a TCP reachability blocker for the next diagnostic, not evidence that
the database endpoint is unreachable from serving cells. Do not infer a firewall
rule or its owner merely from the timeout.

20:15 direct preview: disabled generation14, globalSafetyFailure=database_pool_pressure,
123 global-safety-blocked,2 source-unclean,0 open migrations. Independent metrics
show191 SQL failures in2m and another worker poll failure. Recent completions and
aborts remain0. Enablement remains NO-GO.

Required next action: restore this operator machine's TCP reachability to the
Cloud SQL endpoint, or supply an approved reachable diagnostic execution host.
Then run the bounded read-only wait sampler during a spike to identify the
blocking wait/resource before proposing a production change. No further IAM
broadening, SQL change, deployment, drain, or enablement is justified yet.

## Diagnostic route recovered — 20:20 UTC

Under the user's instruction to find a working route, enabled Cloud Shell API
and started/authorized their Cloud Shell session. Installed no database roles or
firewall rules. Existing cloud-sql-proxy and psql successfully connected from
Cloud Shell; PostgreSQL confirmed default_transaction_read_only=on. This resolves
the local TCP reachability blocker without user setup.
Bounded240s aggregate pg_stat_activity sampler now runs at1s cadence, retaining
only wait type/event, counts, oldest active query age and blocker counts. Local
evidence: .tmp/rehome-cloudshell-waits-20260914.txt. Proxy is process-owned and
terminated at completion; no credential values are persisted in evidence.

## Direct database capture result

Cloud Shell route WORKS; no operator network action remains. The240s sampler
completed and its temporary proxy was stopped. All captured sessions reported
readOnly=on. Summary: {"samples": 241, "start": "2026-09-14T20:21:14.768809+00:00", "end": "2026-09-14T20:25:13.809436+00:00", "maxActive": 180, "maxWalWaiters": 165, "allReadOnly": true}

A spike at20:23:12–20:23:25 rose to180 active sessions. At20:23:24.941,153 relay
and12 auth sessions waited on LWLock/WALWrite. Other samples show WALInsert,
BufferContent and ProcarrayGroupUpdate; only0–2 application-blocked sessions
in the main burst. This demonstrates a transient write-path queue hidden by
minute-level averages, but does not by itself identify the initiating writer
or justify changing commit durability. Ordinary WAL waits also occur when
healthy and must not be labeled an incident alone.
Postgres17.10 has synchronous_commit=on, track_wal_io_timing=off. pg_stat_statements
is not installed in the relay database; the attempted SELECT failed without
changing state. Do not install extensions or toggle synchronous_commit to
bypass this. Query Insights remains available for statement-level aggregates.
Latest direct preview20:25: disabled generation14, cohort10, globalSafetyFailure=null,
123 eligible (121US→Asia,2Asia→US), no open migrations. Eligibility/safety fluctuate;
no migration enablement or new completions are claimed.

## Bounded corrective proposal — 2026-09-14 20:35 UTC

Cloud Shell connectivity and Terraform planning both work. No user network or IAM
action remains. Rehome is still disabled at generation14, cohort10, no new moves.
The shared database is not continuously saturated: previous direct burst peaked
at180 active sessions/165 WAL-related waiters, while the new six-minute capture
is predominantly2 active sessions. Do not claim a broad outage or that a
checkpoint alone is the cause.

New read-only evidence:
- wal_compression=off; full_page_writes=on; synchronous_commit=on.
- wal_buffers is8192 PostgreSQL blocks (64MiB), and wal_buffers_full did not
  increase across the prior burst or this capture. Increasing buffers is not
  justified by these observations.
- Relay activity leases have~12,122 live tuples,~10.7MB table and~31MB indexes;
  lifetime HOT updates8962/1,110,318,145. The expiry index makes ordinary renewal
  updates maintain indexes. This establishes write overhead, not the burst trigger.
- Query Insights lock_time units verified as microseconds. Previously reported
  renewal lightweight wait delta228175882 is228.176 aggregate session-seconds,
  not228 seconds of wall-clock outage.
- One-second pg_stat_wal deltas are statistics-reporting intervals, not a direct
  storage-bandwidth measurement. A reported~85.6MB delta at20:32:36 had only9 active
  sessions; it does not establish a storage stall or prove causation.

Prepared a narrow, reversible mitigation trial: enable wal_compression=lz4 on
onorca-cloud:us-central1:orca-cloud-auth-db. Google POSTGRES_17 flag metadata
explicitly reports requiresRestart=false. Preserve max_wal_size=16384, disk250GB,
tier4CPU/15GiB, synchronous_commit and full_page_writes. Compression can lower
full-page WAL volume but has CPU cost; it is NOT a proven cure for the observed
WALWrite bursts.

Owning configuration: stablyai/orca-cloud infra/terraform-foundation (not apps or
relay Terraform). Snapshot and saved targeted plan are inside this worktree at
.tmp/rehome-foundation-review/infra/terraform-foundation/. Baseline target plan
has no infrastructure drift. Candidate plan:0add,1in-place change,0destroy; sole
resource change is adding wal_compression=lz4. Two non-sensitive database-name
outputs are also added to state. Saved plan SHA256:
781406e2d26ece1a0f110040868f3ef05c5838e16d293f678bf3fcefc3d30622.
No Terraform apply or production database flag mutation has been performed.

Local validation: isolated postgres16-alpine container, internal port55440 only
(no host port published; existing user test database untouched),1CPU/512MiB,
12,000 synthetic indexed lease rows. Alternating off/lz4 checkpoint+update rounds
produced7,286,784/6,468,072 and7,709,312/6,541,184 WAL bytes:11.2–15.2% reduction.
This validates the mechanism on synthetic data, not production latency or a
guaranteed production reduction. All rounds retained12,000 rows. Owned container
removed after test; no durability settings were relaxed.

Concrete proposed next action: approve a controlled shared-database compression
trial, distinct from the already-approved10% migration enablement. Before apply,
recheck current flags, exact saved plan, live operation/rollout lock and serving
state; acquire the existing cross-repository SQL lease. After apply, verify both
Cloud SQL flags and SHOW wal_compression, then observe at least20min spanning
multiple checkpoints using1s aggregate waits plus fleet SQL/recovery/health and
CPU metrics. Keep rehome OFF during this trial. Revert compression through the
owning targeted Terraform configuration if sustained CPU exceeds70% for5min,
new persistent health failures appear, or errors worsen; replan to remove only
wal_compression while retaining max_wal_size=16384. No force restart. If bursts
persist, report the trial inconclusive/ineffective and continue diagnosis; do not
relax migration safety bars. Only after stable evidence and a fresh15min monitor
pass should the already-authorized10%/10hosts-per-minute canary start, with5NEW
completed migrations as its success criterion. Keep the owning configuration
change reviewable in orca-cloud if the trial is approved/retained.

### New burst supersedes the immediate compression-trial recommendation

The six-minute capture finished with361 samples and caught a burst20:35:26–38:
peak171 active sessions. At20:35:35,114 relay queries waited on BufferContent;
query_id=-8619927075393881034 dominates. WALWrite waits coexist, but compression
is not established as the relevant first correction. DO NOT APPLY the saved
compression plan pending query-family identification and page-contention analysis.
No approval request for that experiment has been sent. Owned remote sampler/proxy
stopped cleanly. Concrete next step remains read-only identification of this query.

### Query identified and operator decision prepared — 20:38 UTC

Read-only query-family check matches both assignment_state AS MATERIALIZED and
migration_state AS MATERIALIZED for query_id=-8619927075393881034. This prefix
occurs only in renewPostgresControlActivity in the reviewed source. The family
lookup includes idle sessions and its71/77 session counts are NOT active counts.
Active wait counts come only from the bounded sampler above.
Independent20:37 fleet snapshot:11,824 controls across23 cells,254 SQL failures
in2min, max23 pool waiters/503ms pool wait,1 regional-rehome-poll failure,0 activity
recovery failures,0 active migrations and0 recent completions/aborts. Enablement
remains NO-GO. Previous clean20:34 preview had121 eligible host assignments
(119US→Asia,2Asia→US), not distinct users and not currently safe-to-move claims.

The remaining concrete operator decision is whether to authorize the prepared
shared-DB WAL compression mitigation experiment. It has a verified one-flag
plan, no restart requirement, synthetic WAL reduction evidence and rollback/read
paths, but is not a proven cure for BufferContent/WALWrite contention. The earlier
DO NOT APPLY instruction means the saved plan is not authorization: require the
operator's specific trial decision and revalidation before applying. If not
authorized, continue read-only root-cause investigation rather than starting
migrations or changing database capacity/indexes. No Cloud Shell diagnostic
process or local test container remains running for this capture.

## Historical baseline and stronger investigation — 2026-09-14 20:49 UTC

User explicitly requested investigation before deciding on a database change.
Withdraw the compression-approval request for now. No production changes made.
Read-only evidence now spans Sep13 00:00 through Sep14~20:41 UTC, with complete
fleet runtime coverage of2760 samples/hour (23 cells*120); Sep14 08h has2759.
Partial20h is excluded from full-hour comparisons. Retained evidence contains
only aggregate metrics, no host identities. Artifacts:
- .tmp/rehome-historical-baseline-20260914.json
- .tmp/rehome-earlier-baseline-20260913.json
- .tmp/rehome-db-history-20260914-full-hours.json
- .tmp/rehome-renewal-history-20260914-full-hours.json
- .tmp/rehome-db-error-classes-20260914.json

| Period UTC | Mean connected controls | Fleet SQL failures/hour | Cell30s samples with pool wait>250ms | Failures/1000control-hours |
|---|---:|---:|---:|---:|
| Sep13 17:00–20:00 | 8307 | 649 | 3.27% | 78.1 |
| Sep14 09:00–17:00 | 11931 | 1491 | 10.39% | 125.0 |
| Sep14 17:00–20:00 | 12109 | 1057 | 6.87% | 87.3 |

Recent vs same hours yesterday: controls+45.8%, SQL failures/hour+62.9%,
failures normalized by control-hours+11.8%; long-wait sample fraction~2.1x.
Recent vs earlier today: SQL failures/hour-29.1%, controls+1.5%, normalized
failures-30.2%, long-wait sample fraction-33.9%. This does NOT establish a new
last-few-hours incident. It does establish recurrent latency/failures, worse
than yesterday's lower-load baseline. Normalized controls are a workload proxy,
not distinct users, affected-user counts, or a per-query failure percentage.
The earlier commentary+14% used Sep13 16–20;+11.8% uses matched17–20 hours.

Worst fleet SQL-failure hours today were00h7891 and01h11577, well before this
cohort configuration/diagnostic session. The mechanism differs: PostgreSQL logs
show00h2811 and01h2958 lock timeouts, versus17h187/18h109/19h159. NOWAIT cannot-
obtain-lock messages are also much higher overnight but can be intentional sweep
deferrals; do not count every such DB log as user impact. Recent client-lost
logs382/378/722 remain real but do not independently identify the initiating cause.
A first whole-day DB-error query hit50000 limit and was discarded; the retained
42841-row aggregate uses only00–02 and17–20 windows, with no truncation.

Independent Cloud Monitoring shows current hourly CPU~44%, similar to earlier
today and higher than yesterday~33–34%, with memory~45% and no sustained resource
exhaustion. Query Insights renewal rate rises from~270/s yesterday to~390/s today,
consistent with the higher control count rather than a new timer-frequency jump.
Lightweight renewal wait time rose earlier today and fluctuates, not monotonically
in the last few hours. Metrics use correct cumulative-to-rate alignment, and
full-hour artifacts align exactly to UTC boundaries.

Additional read-only investigation: EXPLAIN (NOT ANALYZE) of the renewal query
with synthetic identities on the live schema shows expected primary-key index
scans on assignments, migrations and activity leases, each estimated1 row;
no base-table sequential scan. This establishes available indexed access paths,
not production execution latency or the identity of a contended page. No UPDATE
was executed. Source: .tmp/rehome-renewal-explain-20260914.txt.

An8-minute bounded1s sampler also records pg_stat_progress_vacuum alongside active
waits and WAL counters, to test whether maintenance coincides with another burst.
A quiet interval cannot rule out maintenance as a trigger. Neither compression,
a missing index, nor autovacuum has been established as the initiating cause.

### Second live burst and narrowed evidence — 20:51 UTC

The new capture reproduced bursts20:49:23–27 and20:49:52–58, with peak186 active
queries. Wait mix again includes BufferContent (peak66) and WALWrite (peak64),
and the renewal query remains dominant. No pg_stat_progress_vacuum row was
reported during these samples. One vacuum on relay_assignment_region_preferences
was observed at20:46:12 while only4 queries were active. This is negative evidence
for a concurrent sustained vacuum as the trigger, not proof that all maintenance
can be excluded. The burst is also not at the five-minute checkpoint start.

Reported WAL bytes/sec did not surge during this burst (sample medians~1.22MB/s
burst vs1.50MB/s quiet); reported sync count rate fell~330/s to28/s. Statistics
publication and group commit affect those counters, and WAL I/O timing is off,
so do not equate inverse sync rate with measured fsync latency or use it to
claim storage saturation. This weakens the case for approving compression as a
root-cause fix solely from WALWrite waits.

Matched17–20 UTC independent metrics: mean CPU33.61% yesterday vs43.80% today;
renewal result rate267.99/s vs390.63/s; renewal lightweight lock wait rate
0.0319 vs0.1970 aggregate waiting-session equivalents. Higher waiting per renewal
is real, but the last few hours remain better than much of today's daytime
fleet error/pool-wait baseline.

20:50 direct control/preview still disabled14/cohort10/open0, global safety
database_pool_pressure;111 source-unclean and8 target-unclean, with historical
outcomes139 completed/1 aborted and no new completions. Compression remains
unapplied. The concrete next diagnostic is the initiating resource/operation
behind the renewal burst, not an unreviewed flag/index/capacity change; the
historical-baseline question is answered and no operator approval is pending.

Completed bounded sampler: {"samples": 481, "start": "2026-09-14T20:43:27.920422+00:00", "end": "2026-09-14T20:51:26.961787+00:00", "maxActive": 186, "readOnly": true}.
Cloud Shell command exited successfully; its owned proxy was terminated.

## Step1 impact baseline — 2026-09-14 21:12 UTC

Retained aggregate evidence: .tmp/rehome-impact-baseline-20260914.json and
.tmp/rehome-recovery-coverage-20260914.json. Coverage2280 renewal samples/hour
(19 populated cells) versus2760 total (including4 empty cells); coverage of
active controls is separately checked, and missing fields are not treated as0.
Correction: actual success counter is controlActivityRecoveriesDelta; the first
request for controlActivityRecoverySuccessesDelta returned missing, not0.

17–20 UTC:5,206,176 observed query operations,3170 failures (0.0609%);
4,222,259 renewal attempts,3001 database-error outcomes (0.0711%),7 lease misses.
There were5 recorded successful lease recoveries and0 failed recoveries.
Do not infer a one-to-one match for the other2 misses: a session may be superseded
before recovery, and these are aggregate counters without identity correlation.
7082 completed client accepts and7 abandoned attempts; abandonment includes
client cancellation and does not establish database causation.

Recent complete minutes with>=100 SQL failures (15 minutes):renewal error rate
0.9541%,0 lease misses,0 failed recoveries,0 abandoned accepts. Peer-timeout
close rate2.409 per1000 control-minutes vs2.642 in214 quiet minutes (<=5 failures).
This gives no evidence of a contemporaneous session-drop increase in those
minutes; it does not prove every user was unaffected or establish delayed impact.
Each close counter counts socket events, not unique users. The heartbeat sends
pings independently of the renewal promise; ordinary SQL errors do not directly
close the socket, and the next heartbeat retries within the existing lease runway.

The earlier00–02 UTC event is materially different:238 lease misses and21 failed
recoveries, versus none in17–20. Do not generalize the reassuring recent recovery
result to that earlier incident. Keep recovery failures and lease misses as
post-deploy correctness gates, not just SQL-operation failure count.

## Step2 reproduction in progress

Isolated postgres16-alpine container orca-rehome-renewal-contention-proof uses
internal55440 only,2CPU/768MiB, no published port and no contact with the existing
user test database. Uses the actual renewal CTE and three actual table schemas,
12,000 synthetic leases,96 clients,400 renewals/s. The first attempt exposed a
benchmark-only parameter type inference error; corrected with explicit bigint
casts and discarded that attempt. Valid90s baseline:36,110 transactions,0 failures,
1.917ms average latency,401.5TPS. Thus steady local400/s alone does NOT reproduce
the production stall. Do not claim a missing index or query defect from load alone.
Local counters reproduce lease HOT starvation (0 HOT updates vs~98% on assignments),
but the role of expiry-index maintenance in production bursts remains a hypothesis.
A bounded higher-concurrency run tests whether it amplifies contention. No
production SQL/index/flag change and no fix deployment have been made.

Step1 completion evidence: a separate historical query found NO nonempty-cell
runtime sample missing renewal counters in17–20 UTC. Measured impact baseline
is therefore complete for this scope. In43 spike-and-next2-minute windows,
peer-drop rate2.417/1000control-min versus2.744 away from spikes;1 lease miss,
0 failed recoveries,0 abandoned accepts. No contemporaneous or next2-minute
aggregate drop increase was established. Unique-user attribution is deliberately
not claimed. Steps2–4 remain incomplete.

Additional Step2 result: local96-client unrestricted60s stress achieved319,897
renewals (5319TPS),17.813ms average,0 failures. WALWrite waits appeared but no
production-scale stall was reproduced. Production renewal phases at21:12 are
spread across all30 seconds:343–469 live leases per bin; no large synchronized
renewal cliff is evident in the durable timestamp proxy. Production lease
primary-key index~5.0MB, expiry index~25.9MB; index size alone does not prove
bloat or identify the contended page. No speculative index change is justified
solely from this size or a stress test at unrelated throughput.

### Step2 diagnostic prerequisite implemented — 21:26 UTC

Confirmed in both postgres and orca_relay databases: pg_stat_statements collector
is already in shared_preload_libraries, but no extension SQL views are installed.
pg_wait_sampling is off and would require a restart, so it was not enabled.
The existing relay schema identity has CREATE, cloudsqlsuperuser and pg_read_all_stats.

Prepared an observation-only migration in an isolated checkout INSIDE this worktree:
.tmp/rehome-statement-observation, branch fix/relay-postgres-statement-observation,
base68f0b2e8355d3376e4ace32b1ae0cb81f068bdab. Existing worktree edits preserved.
The migration exposes the already-preloaded pg_stat_statements collector, skips
when absent/unavailable, yields via transaction advisory lock to one installer,
and tolerates missing privileges. No collector reset, preload/configuration
change, raw query export, or database restart. It runs through existing schema
startup and the owning director deployment workflow, not manual production SQL.

Five real PostgreSQL integration tests pass with preload on and off: actual startup
wiring/idempotence/no stats reset, restricted roles with/without setting visibility,
concurrent installer safety, and yielding to another installer. Initial test caught
current_setting permission failure; corrected to visibility-safe pg_settings read.
Local build/typecheck passed. Full-suite first run found missing test-only infra/dev
files in the runtime build image and one schema-DDL classification assertion needing
the exact new migration; addressing these, not suppressing failures.

This is a prerequisite to attribute WAL/buffer work to queries and diagnose Step2,
not the final performance correction. Steps3–4 must remain incomplete until a
measured correction and production improvement are proved.

Diagnostic PR: https://github.com/stablyai/orca/pull/20712
Head a8a0b2da4f (fix/relay-postgres-statement-observation). Focused PostgreSQL
preload-on/off tests passed5/5 each. Full relay suite passed714 tests with1skip
on a fresh database; repeated use of the earlier test DB had exposed stale fixture
rows and was discarded. Build and typecheck passed. PR checks/merge/deploy pending.
This still completes only the observation prerequisite, not Steps2–4.

### Diagnostic rollout preflight — 21:33 UTC

PR20712 build, full Cloud Verify tests, Terraform, secret scan and PR checks pass;
automated pullfrog review remains running. Final local validation is in the PR body.
Live readback confirms serving00615-zin, predecessor digest fba845b47fcd5e7978c8d3b8fd7e10940051696a614a5ce0d4c0e5af28e804c3,
minimum5/maximum5, ready=True,100%traffic. Durable control14 remains disabled,
cohort10,rate10/min; preview currently refuses with database_pool_pressure.
At21:31 runtime2min aggregate:11539controls,3SQLfailures,maxwait558ms,
0failed lease recoveries,0active migrations. A quiet short window is not an enable gate.

Reviewed non-test relay source delta from current served image to diagnostic head:
three already-merged scan/sort optimizations plus observation migration. No eligibility,
lease SQL, timer, or timeout change in that delta. Reverify final publish commit delta.
Read-only statement-counter SQL validates on isolatedPG16. Post-deploy oracle:
exact ready digest + stats view visibility/reset epoch and aggregate counters;
then independent runtime errors/recovery and durable control readback.
Rollback must redeploy predecessor through owning director workflow if necessary:
the workflow creates selector-rollback with the NEW digest, so that tag alone is not
an old-code rollback. Schema exposure is additive and compatible with predecessor;
never DROP EXTENSION/reset counters as rollback. No cells/flags/traffic changed yet.

PR20712 merged through normal GitHub merge path (no admin bypass), commit
 d51747e4c40b600db52658daaee2cb55dc0d2d05. Required CI passed; optional pullfrog
was still running at merge request. Publish run34899432080 dispatched frommain;
verified runhead equals this commit and cloud/workflow delta to tested head is empty.
Combined1s aggregate statement/WAL/vacuum/wait reader also validates onPG16.
Production deploy pending immutable image; rehome remains off.

Publish34899432080 succeeded. Diagnostic image: sha256:20434ed4f72926170808c59dcec799ab867c27b55d0520484bd262d69b7974d7
Director-only dispatch inputs saved in .tmp/rehome-statement-deploy-inputs.json;
keep generation14 disabled/cohort10/placement preserved, no pruning or identity change.

Director diagnostic deploy34899683676 started at exactmain d51747e4c40.
Immediate prior admin read:control14off,cohort10,0open,122eligible (118US→Asia,
4Asia→US), no preview safety failure at that instant. This does not replace15min gate.
Automated review later raised optional $libdir preload-name compatibility. Confirmed
production preloads the bare pg_stat_statements name, so current target is covered;
portability follow-up is separate and does not invalidate tested production behavior.

### Live statement measurements available — 21:40 UTC

Observation migration exposed the preloaded collector. Reset timestamp remains
2026-07-09T05:23:09.863207Z (preserved); view-readable oracle passed.
First query requesting statement text timed out at2s; switched to
pg_stat_statements(false), numeric counters only, and succeeded. Raw SQL/identity
values are neither printed nor retained. Separate bounded server-side classifier
reports only queryid, operation kind and relation names.

21:38:22–21:39:39 quiet77s:28,842renewals averaging0.295ms/16.17MB WAL;
2,163auth refresh-token inserts averaging2.365ms/73.71MB WAL. Auth token insertion
is a larger WAL producer at current workload, not only historically. The historical
large slow auth UPDATE is family revocation, but has no calls in this interval;
do not confuse the Sept4 incident with today's measured bursts.

Combined480s read-only sample started21:38:22 (statements/WAL/waits/vacuum/IO),
artifacts .tmp/rehome-combined-counters-20260914.txt and derived statement-deltas JSON.
At21:40 no >20active burst yet. Stable and candidate health/ready return200.
Deploy34899683676 still in progress; final digest/traffic oracle still pending.
Auth source inspected read-only in nested .tmp/rehome-auth-observation (private
application repo, no edits); current serving auth00051-qar/digestef2c2488 captured.
No authentication/runtime tuning, pruning, cell change or rehome enablement performed.

### Diagnostic deploy verified — 21:41 UTC

Run34899683676 succeeded; ready serving00620-wev receives100%, digest20434ed4…,
minimum5/maximum5. New rollback tag00619-bak is the same diagnostic image;
predecessor fba845b4… retained as explicit redeploy fallback. Collector view readable
and reset unchanged. Independent runtime2min:23SQLfailures,8maxwaiters,154msmaxwait,
0failed recoveries,0active migrations. Control14off/cohort10 verified again.

Sampler correction: initial combined read stopped after101samples at21:40:01 due
2s query timeout; psql watch returned success despite that failure. Thus there is
NO480s coverage yet. Fixed bounded reader to emit failed-sample gaps and continue,
reduced stats/IO sampling to5s, and separated1s activity/WAL capture so an expensive
stats read cannot hide the wait event. No diagnostic timeout increase for these reads.
Auth exact source is a995f4c8ed7771ffb80e575d90f6f77f1bdd3a29, matching nested checkout.

### Step2 narrowed to an independently measured contributor — 21:48 UTC

Current auth refresh_tokens:~74.99M estimated live/3.40M dead tuples,21.52GB table,
34.50GB incl indexes; primary index9.74GB. Last autovacuumSept13 04:32UTC.
Pruner page SELECT(-263467947205086677) independently classified by exact MAX(token_hash)
shape; cumulative mean6.45s/query,62.54M blocks read,97.60Mms measured readtime.
This SELECT itself generates WAL (hint-bit/full-page work), not just DELETE.
Current hourly jobs scan145k–285k rows to delete~2k–4k, stopping ontime/statementbudget.

Compared runtime minute counts with actual job start/end (logend minusduration):
Sept13 matched17–20UTC: during-prune627/560880 SQLfailures(0.1118%) vs
outside1320/3237835(0.0408%); Sept14 available17–21UTC:during1135/854757(0.1328%)
vs outside3001/6031107(0.0498%).~2.7x association in both windows. Minute-overlap
classification; correlation is not proof of all causes. Many spike minutes occur
outside pruning; do not declare it the sole cause. Artifacts:pruner-history,
pruner-correlation,auth-table,pruner-families/counters under.tmp/rehome-*.

Next: reproduce actual random-primary-key page-scan read amplification on an
isolatedPG16 with checksums; compare a bounded physical-page strategy while
preserving exact retention predicates. No production pruning/policy change yet.

### Step3 targeted correction under development — 21:53 UTC

LocalPG16/1M synthetic auth rows reproduced scatter-read amplification: original
pruner page5000rows/5000heapfetches/5083buffers/26.76ms;128–200block physical
range candidate4800rows/200buffers/0.94ms. Different windows and warm OS cache;
use buffer-per-row improvement(~24x), not these latencies as a production promise.
No production stall was deliberately induced. This proves a query-level mechanism,
not that pruning explains every relay failure.

Implementing bounded PostgreSQL heap-page scan in private app checkout branch
fix/auth-pruner-physical-page-scan. Reuses existing budget/retention/reporting loop;
keeps SQLite/key-range path, same retention predicate, bounded delete count,
transactional cursor, file identity reset after table rewrite, repeated page on
row-budget exhaustion, locked-token skip revisited on later full passes.
No index build, VACUUM FULL, auth token semantic change, or WAL flag change.
Current production pruner actually remains on343a0915…(older than served auth).
Need exact pruner image delta + owning workflow update/rollback before deployment.

Bounded diagnostics completed:480successful1s wait samples21:43:03–21:51:02,
peak136active21:48:39 (WALWrite + BufferContent, renewal age~1s); stats5s stream
has one explicit failed sample and continued. Hourly pruner ended21:48:45 with
statement-timeout,185k scanned/2971deleted. Required15min enablegate not run.

### Targeted correction validated locally — 22:06 UTC

New physical pruner passed12 realPG16 integration tests: all retention categories,
exact row budget/page revisit, concurrent batches, table rewrite, cursor failure
rollback, actual bounded TID scan/delete plans, skipped locked rows onnextpass,
and real statement timeout rollback. Two regressions fail on oldimplementation:
oldpruner exceeds7-row budget and does not useboundedTIDplan. Full authsuite156/156
passed; build/typecheck, six production workflow boundary checks and actionlint pass.

Added pruner-only mode to existing deploy-auth-production owning workflow with
exact predecessor check, active execution refusal, immutable rollback input,
execution-only proof overrides2000deletes/120s/2s statements, and failure rollback.
No IAM change and no auth service/traffic mutation inpruner mode. Validated actual
GCE-independent CloudRun execution read:0active. Initial date-filter syntax was
rejected by gcloud; replaced with projected metadata JSON + completionTime check.

Old pruner image343a0915…maps to803495520ee0049e0b513bc74228632a50278521;
reviewed runtime-import delta tocurrentappmain: only database successor_material
column probe/addition already live underauth00051-qar. Pruning policy unchanged.
No production pruner mutation yet; PR/CI/deploy/proof and sustained relay improvement
remain outstanding. Operator action remains unnecessary.

Correction PR https://github.com/stablyai/orca-cloud/pull/485 opened;
head926a8aadd740c42826ba2afcf4294b9dd4999082. CI running. Packaged job proof on1M
synthetic rows deleted exactly2000 from101376 examined in7031ms (33batches),
stopReason=row-budget, scanStrategy=heap-pages; retention30/60/7days unchanged.
All owned local PostgreSQL containers and bounded remote samplers/proxies stopped.
Remaining Step4: merge verifiedhead, pruner-only auditeddeploy+boundedproof,
independent live before/after measurements, sustained improvement and fresh
15min monitor before approved10%canary. Step2 still does not explain outside-pruner
bursts; retain that open question even if the contributor correction succeeds.

Initial PR485 CI allgreen. Final workflow-only followup aaa5855 adds a second,
explicit20000-row proof after the2000-row first proof; both retain120s/2s limits.
This permits comparison at the scheduled row budget without waiting for the next
hour or conflating reduced work with improved implementation. Boundary tests and
actionlint re-pass; waiting for CI onfinalhead beforemerge. First dispatch inputs
saved .tmp/rehome-pruner-first-proof-inputs.json; expected predecessor remains343a0915….

### Resumed production proof — 2026-09-14 23:14 UTC

PR485 merged as cd84f58be6519cd0c5e882bbe494a494815313d7; all five checks
passed, including PostgreSQL16/17. Main matches merge. Prestate verified:
pruner image343a0915… remains current, zero active executions. Control14 disabled;
cohort10, zero open migrations,139 historical completions. Preview currently
blocks119 candidates on database_pool_pressure. Independent2min runtime window:
23cells/11184controls,16SQL failures,0recovery failures,max14poolwaiters/387ms.
This is not enablement evidence. Proceeding with authorized pruner-only2000-row
proof, fixed120s/2s execution limits, old digest rollback, independent counters.
User informed of unchanged retention/auth semantics and changed cleanup order;
locked eligible records can remain until a subsequent full pass. Production
benefit and sustainable cleanup throughput still require proof.

First production proof PASS: owning workflow34907957915 (mergecd84f58),
image sha256:23087f22f9c94fbd7ccb8ce286dee02022e17c84d936912c0ad580967ac71ab7,
executionorca-cloud-auth-token-pruner-ht8qp. At23:17:17Z:2000deleted/7552scanned,
2batches/578ms,row-budget;90revoked/1910rotated, unchanged30/60/7dayretention.
Independent pg_stat_statements: pagecount2calls/218readblocks/35.28ms/627891WALbytes;
delete2calls/0reads/7.52ms/884788WALbytes. No stats reset/eviction observed.
Initial physical region is dense in eligible records; not representative full-table
throughput proof. Latest oldrun22:52:01:280000scanned/4803deleted/483918ms,time-budget.
Auth5xx0/5min, authhealth/directorhealth/ready200;23cells/11221controls,
23SQLfailures/2min,0recoveryfailures. Proceeding sameimage20000-row proof with
120s/2s limits. Rehome stilloff; no newmigrationcompletions.

### Production correction verified — 23:24 UTC

Second proof workflow34908260013 SUCCESS, same immutable23087f22… image,
executionorca-cloud-auth-token-pruner-9qtsp. Summary23:22:58Z:20000deleted,
1122372scanned,291batches,68497ms,row-budget,no timeout;18579revoked/1406rotated/
15expired under unchanged30/60/7daypolicy. Independent statement deltas:
pagecount291calls/33185reads/3645.68ms (3217.33msreadtime)/70863436WALbytes;
delete291calls/0reads/593.21ms/78804599WALbytes. Page reads/scannedrow0.02957
versus oldsample61562/70000=0.87946 (~29.7xfewer). Different physical regions,
retention density and cache conditions; do not promise equal full-table rates.
Auth5xx0/5min. Runtime23:23:05:11208controls/23cells,8SQLfailures/2min,
0recoveryfailures. Job image rollback remains old343a0915… via owningworkflow.

Unresolved independent burst23:20:35Z occurred BEFORE second jobstarted23:21:48:
64renewal sessions active (36BufferContent/17WALWrite/11running), pruning counters
still2calls/2000rows fromfirstproof. Runtimewindow204SQLfailures/0recoveryfailures,
max44poolwaiters/2001ms,1rehomepollfailure. This disproves cleanup assolecause;
no basis to call all failures fixed. Rehome staysdisabledcontrol14/selector230.

Schedule budget remains20000/hour (480000/day). Recent token insertionrate~27/s
is >2M/day if sustained; need representative ingress/deletion/retention-cohort
comparison to establish sustainable maintenance capacity. No budget/schedulechange.
Starting fresh strict15min monitor on verifiedselector230/memberships. FiveNEW
canary completions remain unmet;139historicalcompletions are not credited.

Strictmonitor34908710322 dispatched, read-only15min gate running; migrationsoff.
CloudSQL independent23:19–23:22 CPU41–47%,memory44.5–44.8%; relayLWlocktime
spikes during23:20 burst and recedes duringactualcleanup23:22. No saturationproof.
Bounded independent600s sampler finished after coveringbothproofs; artifacts
.tmp/rehome-pruner-proof-2315-counters.txt and corresponding-deltas.json.
CloudMonitoring24completehourbuckets: authDB2270910inserts/119965deletes,
~94621inserts/hr vs max20000pruner deletions/hr. This is database-wide, not a
retention-cohort estimate; confirms capacity mismatch warrants deeperreview,
not permission to raise deletionload blindly. Checkpoints287scheduled/1requested
in24h, consistent5min cadence; minute buckets place completions23:14/19/24,
not directproof of checkpoint causality for23:20:35stall.

### Follow-up diagnosis — 23:34 UTC

Small read-only physical samples through existing auth credentials (2s statement
limit; aggregate output only) temper the maintenance-capacity claim. Seed914:
5618 rows,24eligible revoked/0eligible rotated/0eligible expired;3702revoked,
1915rotated. Independent seed915:5297rows,55eligible now,9newlyeligible nextday,
117nextweek. Physical clustering makes these rough samples, not precise backlog
estimates. High current inserts are a long-term turnover concern, NOT proof that
20000/hour cannot handle today's retirement flow. Preserve retention and budget.
The relay DB identity's SELECT denial was correctly treated as unavailable, then
read through the auth plane's existing secret with default_transaction_read_only;
no grants, credential artifacts, or SQL writes.

Native probes23:33: all readiness endpoints200 for c4/c5/c17/c18/c19/c23/c27/c29.
Allhealth200 except one unverifiablec18 request; independent23:34:13 c18 health
andreadyboth200. This is transient request evidence, not sustained healthproof.
CloudSQL operations: no backup/update/failover near23:20burst; lastbackup03:47–03:55.
Checkpoint logs23:18start/23:22:31complete show deliberate269.867swriteperiod,
0.068ssync, not a4.5minute fsync. PostgreSQL WAL I/O timing remains off; CloudSQL17
supported flag catalog exposes track_io_timing but NOT track_wal_io_timing.
Do not invent a supported flag or attribute LWLock waits to disk latency without
an independent timing signal. No database configuration changes made.

### Final post-correction gate verdict — 23:40 UTC

Owning monitor https://github.com/stablyai/orca/actions/runs/34908710322 passed:
16 samples across the required 15 minutes, all green, selector 230, strict policy.
Read and verified the private summary; no collector/threshold failures reported.
Auth recorded zero HTTP 5xx over the preceding 20 minutes. Auth service remains
orca-cloud-auth-00051-qar at 100% traffic; scheduled cleanup settings are unchanged.

This is NOT sufficient to enable rehome. Immediate independent admin preview:
control 14 disabled, 10% cohort, 0 open migrations, database_pool_pressure;
119 target-unclean and 4 source-unclean candidate decisions. Fleet snapshot:
23 cells, 11277 controls, 13 SQL failures/2 min, 0 recovery failures,
26 max pool waiters and 743 ms max pool wait. Rehome thresholds are 16/250 ms,
stricter than the general monitor's incident limits. Do not raise them to make
this rollout pass. Another outside-cleanup burst observed at 23:38 yielded
232 SQL failures/2 min with no recovery failures; recurring stalls remain real.

Decision: retain the independently validated cleanup image; keep rehome OFF.
The 5-new-completion objective remains unmet (139 historical / 0 new). No user
permission request is pending. Remaining work: attribute the short renewal
WALWrite/BufferContent stalls and demonstrate acceptable worker pool-pressure
windows before another fresh gate and the approved canary. More representative
retention-flow measurements are needed before changing cleanup rate; preserve
all security retention windows. No speculative compression, flags, drains,
capacity changes, or extra deployment is justified by the present evidence.

### Continued failure-reduction investigation — 23:52 UTC

Scheduled cleanup at23:44:59 also passed:20000deleted/1266848scanned,
331batches/79781ms,row-budget,no timeout. Retention unchanged.

A second lead is the B-tree expiry index on activity leases. Earlier production
counters:1110318145lease updates but only8962HOT updates;12122live leases,
30.97MBindexes. Assignment updates were overwhelminglyHOT. Existing phase sample
is broadlyuniform343–469renewals/second across30seconds, so timerjitter alone
is not established as a fix.

Owned isolatedPG16.15 containerorca-rehome-renewal-burst-pg16, internal55440,
no publishedhostport (user's existing55440container untouched),2CPU/2GB,
checksumsON. Actual renewalCTE,12000syntheticassignments; B-tree vsBRIN expiryindex:
steady~400/s:15.87MB vs11.36MBWAL,0% vs99.9%HOTleaseupdates;
120concurrent/12000txburst:14.88MB vs10.36MBWAL,~0% vs99.3%HOT.
Zeroerrors inboth; latency~2.14ms steady and58.3msburst essentiallyunchanged.
This proves~30%WALefficiency, NOT the productionfailurecause orlatencyfix.
Testingmixedauthwrites/1Msyntheticrows pluscheckpoints before anyrecommendation.
Noindex/schema/schedulingchange deployed orcommitted. Production sampler bounded
600seconds; aggregatecounters only. Collecting matchedbefore/afterqueryfailure
rates aroundthecleanupdeploy soquietwindowsarenotmistakenforoverallimprovement.

### Failure-phase instrumentation prepared — 2026-09-15 00:03 UTC

Mixed auth30tx/s with1Msyntheticrows and checkpoints also produced no renewal
failures forB-tree orBRIN, even120clientbursts. BRIN is not a proven failurefix.
Its expiryquerytradeoff is measurable:12krows/100expired, B-tree0.080ms/43buffers
vsBRIN0.618ms/262buffers; same100rows. No indexchangeplanned forproduction now.
Owned benchmarkcontainer removed aftertests.

Post-cleanupnormalizedcomparison(22:15–23:15 vs23:18–23:51:57): SQLfailures
589 vs913/millionqueries; renewalDBerrors585 vs816/millionrenewals; nearidentical
per-cellmeancontrols491 vs489, no failedrecoveries. This is not evidence of
an overallimprovement. Withnewcleanupperiods plus60sgrace separated:35failures/
127879queries(274/M) during/aftercleanup vs859/872037(985/M) outside.
Most failuresremainoutsidecleanup; retaintheindependentlyefficientpruner.

Prepared narrowfailurediagnostics onbranchfix/relay-query-failure-phase inowned
nestedcheckout. PostgresDatabase.query emits only allowlistedcodes, operation
category, acquire/executephase, elapsedtime, andpoolcounts. NoSQL/params/messages/
identities. No retry/deadline/scheduling/schemachanges; originalerrorsrethrowand
clientsrelease unchanged. Explicittransactionqueriesarenotcovered; allsingle-CTE
controlrenewalsarecovered. Testsredonbase(5failures), focused38pass; fullPG16suite
723pass/1skip; typecheckpass. Realdatabase testsforcequeueacquiretimeoutandserver
statementtimeout, verifydistincteventsandreusablepool. IsolatedtestPG16uses
confirmedfree[::1]:55440; user's127.0.0.1:55440containeruntouched.

Nextboundedproductionaction: afterPR/CIandfreshmonitor, observeonec27same-cap
rollout throughowningworkflow; highestfailurecell343failures/87130queries in
post-fixsample. Needimmutabletarget+predecessor, generationbinding, rollbackand
nativedigest/health/eventverification. No rolloutdispatchedyet. Rehomeremainsoff.

Diagnostic PR https://github.com/stablyai/orca/pull/20749 opened at
278ba80eeacbc736e776939fa1c3ea70cb7932d6. CI pending. Final focused9tests passed,
including2realPGphase tests. AllownedlocalPGcontainers nowremoved; IPv4userDBuntouched.
600sindependentlivecapture completed120samples withnogaps. No >=20activequery
burstcaptured inthat5s-samplingwindow; do notclaimthis rulesoutshorterstalls.

c27liveGCEinstance relay-c27-j5ff,asia-east2-a,metadatarelayimage
sha256:d6189b7118b5cc0cf82942c566db392f9ce98a4abeb06044a6df87d4e275a47d,
artifactsource729491597f33031089148bc2fba41a99e0b95de7. CloudSQLproxyimage is
separatefc224915… andmustnotbeconfusedwithrelayrollbackdigest. Latest00:04:51
runtime990controls,pool10total/0idle/17waiting,peak1521mswait. Localmonitoridentity
received401oncellruntime-status; nohealthinferenceorpermissionexpansion. Owning
same-capverifyusesauthorizeddeployidentityforimmutable/runtimecrosscheck.

Reviewedruntimeimage deltafromc27source: alreadymergeddrainlookupoptimization,
hostdataownerlookupreuse,metricspercentilesingle-sort; director-only rehomepoll
anddisabled-controlguard; pg_stat_statementsviewcreationalreadylive. No control
renewalquery/timingchange. Do notdescribeentireimageascontainingonlynewdiagnostics;
PRitselfisobservation-only. RolloutnotdispatchedpendingCI/publish/verify/freshgate.

### Next correction decision rule

| Diagnostic result | Follow-up experiment | Required proof before changing production |
| --- | --- | --- |
| Acquisition timeouts dominate; pool fully busy | Model the measured arrival rate and connection hold times, including regional network latency | Reduced failures within the total Cloud SQL connection budget; bounded queues and no downstream overload |
| Execute failures with `57014` dominate | Correlate cancellation with the exact renewal query and independent server waits | Reproduce the stall and reduce execution time without simply extending deadlines |
| Execute failures with `55P03` or deadlocks dominate | Capture affected transaction/lock family and compare canonical lock order | Deterministic contention regression and unchanged assignment/migration correctness |
| Connection errors dominate | Compare proxy/network failures with application and Cloud SQL events | Independent connection-path evidence; preserve live sessions during any bounded correction |

BRIN remains a lab-only efficiency candidate. Its measured WAL benefit does not
justify changing the expiry index while latency/failure benefits are unproven
and expiry lookups cost more. Timer jitter likewise remains unproven: the live
30-second renewal-phase sample was broadly distributed. Continue from evidence,
not by deploying either candidate merely because it is available.

### Regional pool evidence and diagnostic canary plan — 2026-09-15 00:18 UTC

The 300-second, 1-second server-state capture completed. Regional connections
spend most time waiting for the client, including idle-in-transaction time; this
is consistent with regional round trips consuming application pool capacity.
The identical local workload (1,262 operations) had zero failures in all cases:
RTT 0/pool 10: peak 0 waiters, P95 wait 0.049 ms; RTT 175 ms/pool 10:
peak 18 waiters, P95 295.45 ms; RTT 175 ms/pool 14: peak 6 waiters, P95 17.11 ms.
This reproduces worker pool-pressure breaches, NOT the actual SQL failures.
Owned local PG container removed; user's IPv4 database untouched.

PR #20749 merged as b07c4032ea336b088fe8ca364644c84c960cc0e7. Publish
34911860065 passed. Exact target:
sha256:e74357cc7d5167ff992448dcb726aa89f1940de088a2420576fcfed46639d8dc.
One-cell target: production-gce-c27, asia-east2-a. Rollback:
sha256:d6189b7118b5cc0cf82942c566db392f9ce98a4abeb06044a6df87d4e275a47d.
Protocol 3 before/after, cap 3000, unobserved bound 60; pool remains 10.
Live 00:17 selector 230 with unchanged membership; rehome 14 disabled.
Preview still database_pool_pressure, 129 blocked, 139 historical/0 new completed.

Awaiting fresh monitor 34911862736; exact canary inputs saved locally in
.tmp/rehome-c27-diagnostics-inputs.json. Owning same-cap workflow will verify
predecessor runtime and safety before isolating/draining only c27, replacing its
image, proving new incarnation/digest/health/trust, then restoring admission.
Expected selector 230 -> 231 -> 232, subject to authoritative returned values.
Failsafe keeps a failed cell migration-only with rehome disabled. Recovery uses
rollback mode with the exact image pair and a new monitor/live generations; no
manual drain retries or SQL changes. Postcheck: serving digest plus native health,
reconnect/recovery metrics, and new acquire/execute failure events.

No pool change is planned yet. Same-cap is image-only; any pool correction needs
an owning workflow with exact pool predecessor/target/rollback verification,
aggregate backend headroom, and failure-phase evidence.

Independent Cloud SQL headroom capture 00:18:27–00:19:26 UTC: 60 samples,
zero gaps/errors, 106–130 total backends and 100–124 client backends. Actual
configured max_connections is 500; operational ceiling remains 400 and general
monitor freeze remains 250. This short window establishes headroom in the sampled
period, not a peak-load capacity proof. New bounded failure-event aggregator is
.tmp/rehome-c27-failure-summary.py; only numeric/categorical fields are read.

Monitor 34911862736 PASSED: final continuous window 00:14:42–00:29:56,
17 samples, no failures/freeze. Earlier Cloud Monitoring collection failure reset
the window; final evidence is valid. Dispatched canary 34913460051 at ~00:30 UTC
through cloud-deploy-relay-production-same-cap.yml with recorded exact inputs.
No rehome enablement. c27 pre-canary 00:12:51–00:22:21: 83 SQL failures/26,239
queries, 176 reconnects, zero failed recoveries; latest 1,020 controls. Independent
c27 /health and /ready returned 200. One director polling error at 00:23:13 was
an acquisition timeout while the worker remained disabled.

Canary 34913460051 status at 00:34 UTC: gate passed; rollout is in c27 isolate/drain. No bypasses or rehome changes. Await post-restart digest, health, trust, and restored-selector verification before treating it successful.

### c27 diagnostic canary complete — 2026-09-15 00:55 UTC

Canary workflow 34913460051 succeeded. c27 target digest e743…d8dc served;\ntransition verified migration-only then restored general, heartbeat fresh, trust\nprobe proven, rehome generation14 remained disabled. New diagnostics immediately\nclassified 306 failures from 00:54:00–00:55:41 as acquire-phase connection timeouts:\n216 other + 90 control-renewal, elapsed ~2002ms, pool total10/idle0, waiters\npeak64–66. No execute-phase events observed. Fleet 00:55 snapshot had 281 SQL\nfailure deltas, max waiters62/max wait2002ms, 117 reconnects, zero recovery\nfailure deltas. This is direct evidence of pool starvation under regional hold\ntime. Next: collect a bounded post-canary window, then prepare a reviewed owning\nworkflow extension for an exact pool-size canary (likely c27 only, 10 -> 14),\nwith aggregate backend ceiling and rollback verification. No direct Terraform or\nmanual mutation; no rehome enablement.\nEOF

Post-canary 00:54:00–00:56:48 UTC: 647 structured failures, all acquire-phase\nconnection timeouts (318 other, 329 control-renewal), max elapsed 2002 ms, pool\n10 total/0 idle, waiters 84–85. No execute-phase failures. Fleet snapshot at\n00:56:56: 474 SQL failure deltas, max waiters88/max wait2002ms, 137 reconnects,\nzero recovery failures. The canary did not alter pool shape; these events confirm\nthe regional pool-starvation hypothesis. Keep rehome disabled.\n\nConcrete next action: implement/review an owning capacity workflow extension for\na c27-only pool canary (10 -> 14), binding expected pool predecessor, target and\nrollback values, selector/rehome generations, Cloud SQL backend headroom, and\npost-change acquire-timeout/waiter/recovery limits. Run local validation and CI,\nthen dispatch only after a fresh monitor. Do not use same-cap image workflow or\nmanual Terraform as a pool-change shortcut.\nEOF

User approved attempting the pool correction. Existing production capacity workflow is hard-coded to US 1,000-cap cells and cannot safely target Asia c27 or pool shape; same-cap explicitly rejects pool drift. I will extend the owning workflow/validator with an Asia pool-specific canary contract rather than dispatching a bypass. No production pool mutation yet.

### Implementation status — 2026-09-15

Focused implementation is now present locally and remains un-dispatched:

- Added a c27-only pool-canary validator with exact apply `10 -> 14` and rollback `14 -> 10`, finite Cloud SQL backend/waiting-backend headroom bounds, disabled rehome, and exact selector/control-generation binding.
- Extended the Terraform capacity-plan validator with `pool-canary-cell`, requiring the exact rollback image, reviewed startup `ORCA_RELAY_DATABASE_POOL_MAX`, and exact predecessor pool.
- Wired the same-cap owning workflow/job inputs for pool-canary apply/rollback, c27 restriction, headroom inputs, pool override, runtime pool reporting, and target/predecessor checks. The existing same-cap path remains unchanged for ordinary image rolls.
- Added runtime-status `databasePoolMax` evidence and regression coverage.

Focused checks pass: 22 Node contract/workflow/plan tests and the relay runtime-status black-box test. No Terraform plan, workflow dispatch, production mutation, rehome enablement, or image change was performed.

Remaining blocker before any dispatch: add the workflow-owned post-change observation gate for c27 acquire-phase timeout, execute/55P03, waiter/wait-ms, reconnect/recovery thresholds and explicit rollback invocation, then run workflow syntax/contract checks and a fresh monitor. Exact next action is to complete that postcheck and update this tracker with its thresholds; keep generation 14 rehome disabled.

### Pool-canary implementation gate — 2026-09-15

Approval received to try 10 -> 14 on c27. Review of existing
cloud-deploy-relay-production-capacity workflow found it is not a valid path:
it hard-codes US c7-c26, 1,000/60 capacity, fixed confirmation strings, and
fixed predecessor/candidate images. Same-cap workflow rejects startup-script
pool drift. Therefore no unsafe dispatch was made. Required implementation is a
new owning pool-canary contract (or reviewed extension) with explicit Asia c27,
predecessor pool=10, target pool=14, rollback pool=10, regional hard-cap=3000,
rehome protocol/generation, fresh monitor artifact, Cloud SQL headroom, and
post-change phase-event thresholds. Once CI validates that contract, dispatch
c27 only and compare acquisition failures against the saved baseline.

### Live watch 2026-09-15 02:29 UTC

c27 /health and /ready remain HTTP 200. Fleet last ~2m: 12,834 controls, 457
SQL failure deltas, max pool waiters 111, max wait 2,001ms, 231 reconnects, zero
recovery failures. Diagnostics since 02:15 on c27: 127 events: 120 control-renewal
acquire timeouts, 6 other acquire timeouts, 1 control-renewal execute 55P03;
max waiter 117. Broader event query hit 2,000 cap, so rates are materially high.
Continue holding rehome disabled and do not deploy pool change until owning workflow
extension is reviewed and fresh safety evidence is captured.

Implementation progress: added local validate-relay-pool-canary.mjs and 13 passing
Node tests in the owned diagnostic checkout. Guard currently restricts the first
trial to c27 only, exact 10 -> 14 / 14 -> 10 transitions, valid numeric backend
counts <=250 and waiting <=20, disabled rehome, and matching selector/control
generations. Missing/NaN metrics fail closed. This is only an unintegrated local
contract: it is NOT a deployable workflow, has NOT passed CI, and has NOT changed
production. Remaining: saved-plan pool-only validation, immutable image/metadata
predecessor checks, authoritative fresh monitor binding, runtime pool proof,
post-rollout observation and explicit workflow-owned rollback. Earlier promises
of automatic rollback were premature: the existing same-cap failsafe isolates
failed cells; automatic pool rollback has not been implemented.

Pool plan validation progress: extended validate-relay-capacity-plan.mjs with
pool-canary-cell mode. It requires exact pool/rollback-pool values 14/10 or
10/14, exact rollback image, and validates the startup pool assignment while
normalizing only that reviewed line. Existing capacity-plan and new pool guard
suite pass (17 tests total). Workflow dispatch wiring and a plan fixture remain;
production is unchanged.

### Post-change gate implementation — 2026-09-15

Added `validate-relay-pool-canary-observation.mjs` and regression coverage. The
gate requires a c27-only observation window of at least 300 seconds and three
samples, with acquire timeouts <=20, execute 55P03 = 0, pool waiters <=16, max
wait <=250 ms, and recovery failures = 0. The reusable workflow invokes it
before admission restore and fails closed into the existing isolation/rehome-
disabled failsafe.

Focused validation passes 33/33 across pool/observation contracts, Terraform
plan validation, workflow wiring, same-cap wave, and runtime-status checks. The
remaining operational blocker is obtaining a fresh monitor and performing the
first real post-change capture. The workflow now produces that capture itself;
no caller-supplied local or synthetic payload is accepted.

The evidence source is now workflow-owned: after the target runtime is verified,
the job captures a five-minute c27 window with `gcloud logging read`, filters by
the exact c27 `cellId` and bounded timestamps, aggregates query-phase failures
and runtime pool/recovery metrics, and validates the result before admission
restore. The focused suite is 33/33 after this collector wiring. A post-change
capture cannot be produced before the canary itself runs, so production remains
unchanged and rehome remains disabled.

Workflow syntax validation is clean after fixing the heredoc and shell argument
handling. `actionlint` reports only the repository's pre-existing custom
`blacksmith-2vcpu-ubuntu-2204` runner-label warnings; no YAML or ShellCheck
errors remain. The collector/observation/workflow contract suite passes 11/11.

Follow-up audit corrections: failure logs are now bound to the exact live c27
GCE instance resource ID (diagnostic failure events do not publish `cellId`),
the collector accepts the deployed transaction retry/exhausted event family,
uses `controlActivityRecoveryFailuresDelta`, rejects mixed-cell payloads, and
requires failure-phase telemetry. Pool rollback validation now checks the exact
14 -> 10 contract and reusable workflow calls cannot target another cell.
The workflow now also captures a fresh one-minute Cloud SQL `num_backends`
window and requires its maximum to match the supplied headroom value and remain
<=250. Waiting-backend headroom remains an explicit input because no supported
Cloud SQL metric currently exposes that queue directly. A failed pool-canary
job now seals and uploads an exact rollback authority artifact after isolating
c27 and verifying rehome remains disabled. It still does not automatically
dispatch the separate rollback workflow; automatic rollback remains a
deliberate operator follow-up rather than an implicit recursive mutation.

Fresh read-only strict monitor dispatched through the owning workflow as run
`34999418282` against selector generation `230` and the recorded exact
memberships. It failed at the first checkpoint because live selector generation
was `232`; memberships matched. No capacity or rehome mutation was performed.
Replacement strict monitor `34999651050` is queued against generation `232`.

### Validation hardening follow-up — 2026-09-15

The workflow-owned post-change gate was hardened after review. It now requires
exactly one RUNNING c27 GCE instance for log binding and fails closed when the
Cloud Logging read returns the 10,000-entry API cap, which would otherwise make
a five-minute aggregate silently incomplete. A healthy window with zero failure
events is accepted when runtime samples are present; failure thresholds remain
zero/ bounded as configured, so the gate does not require an artificial failure
event merely to prove instrumentation.

Focused validation is green: 29 Node tests across the pool validator,
observation collector/validator, Cloud SQL headroom, workflow contract, and
Terraform-related pool guards; `git diff --check` is clean. Replacement monitor
run `34999651050` is still in progress (no mutation has occurred). Do not
dispatch the pool canary until that monitor succeeds and exact live c27
predecessor/image, selector/rehome generations, and authoritative Cloud SQL
headroom are recorded. Generation 14 rehome remains disabled.

Replacement strict monitor `34999651050` completed successfully (attempt 1).
Its sealed artifact binds selector generation `232` and the exact recorded
memberships, with 16 samples through the 15-minute checkpoint and no failures.
This clears the fresh-monitor gate only; it is not authorization to mutate.

Exact next action: obtain a fresh read-only c27 runtime snapshot (current image,
pool, instance ID, selector generation, and disabled rehome generation), capture
the workflow-owned one-minute Cloud SQL backend headroom and authoritative
waiting-backend value, then run the pool-canary dispatch gate for an exact
`10 -> 14` apply. If any value drifts, stop and reacquire evidence. Do not
enable rehome generation 14 or use a manual Terraform/gcloud mutation.

### Follow-up gate — 2026-09-16

The successful monitor artifact is now dated evidence from 2026-09-15 and is
not being reused as a current production precondition. A local read-only live
snapshot could not be obtained: the configured `gcloud` user account cannot
mint the service-account identity token required by the Relay admin audience
(`gcloud auth print-identity-token --audiences=...` rejects this account type).
Therefore the current selector generation, c27 image/pool/instance, disabled
rehome generation, and Cloud SQL headroom have not been revalidated. No new
monitor was dispatched with stale generation `232`, and no production mutation
occurred.

Exact next action is to run the monitor-owned read-only inspection from a
configured production workflow identity, bind its fresh selector/membership
artifact, then capture the live c27 and Cloud SQL values before considering the
`10 -> 14` canary. Rehome generation 14 remains disabled.

Read-only refresh from the configured GCP/MIG path found exactly one healthy
c27 instance: `relay-c27-j5ff`, instance ID `4123247033296491207`, zone
`asia-east2-a`, stable MIG, current action `NONE`. Startup metadata binds image
`sha256:e74357cc7d5167ff992448dcb726aa89f1940de088a2420576fcfed46639d8dc`,
`ORCA_RELAY_DATABASE_POOL_MAX=10`, hard cap `3000`, unobserved bound `60`, and
the reviewed protocol trust lines. This is independent GCE evidence; the
admin runtime endpoint returned 401 locally, so no live runtime counters are
claimed. The successful monitor artifact still binds selector generation 232
and the exact memberships.

Cloud SQL headroom evidence in `.tmp/rehome-backend-headroom.txt` contains 60
samples with total backends 106–130 and client backends 100–124. Review found
that the supported Monitoring API does expose the lock-wait signal as
`cloudsql.googleapis.com/database/postgresql/backends_in_wait`; the workflow
gate now queries that metric directly, requires samples, enforces a maximum of
20, and compares the live maximum to the dispatch value. No current waiting-
backend sample has been captured yet. Do not dispatch the canary while the
admin runtime read is 401 or either headroom series is missing; rehome
generation 14 remains disabled.

Implementation follow-up: the headroom verifier now reads both supported live
Monitoring API series: `num_backends` and the lock-wait
`backends_in_wait` metric (filtered to `wait_event_type=Lock`). It requires
explicit expected maxima for both series, rejects missing samples, enforces
backend <=250 and lock-wait <=20, and compares each live maximum to the
dispatch inputs. Focused pool/headroom/workflow tests pass 18/18 with
`git diff --check` clean. This removes the prior “unsupported metric” gap, but
fresh workflow-identity runtime evidence and a fresh waiting-backend capture
are still required before dispatch.
