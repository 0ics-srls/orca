# Relay region correction — idle cutover plan

Status: **PROPOSED; NOT IMPLEMENTED OR DEPLOYABLE**

This plan narrows regional correction to the product requirement: move a host to a materially better relay region once its existing client connections have ended. It does not preserve active data sockets across the move. That removes the need for long-lived source retention and live splice transfer, but it does not remove the need for an atomic cutover.

## User-visible behavior

A phone or tablet that backgrounds may close its relay data connection after the existing background grace period. That timer is only an opportunity; operating-system suspension can delay it. The desktop control socket is separate and normally remains connected. When every client connection and pending admission is gone, the cloud may move the host to a better region. The next client connection resolves the new assignment. A client that remains connected can delay correction indefinitely without losing connectivity.

“Better” keeps the existing evidence rules: a fresh server-issued measurement window, both regions measured, and the candidate at least 25 ms and 20% faster than the measured incumbent. Missing, stale, inconclusive, tied, unsupported, or mismatched evidence means no move.

## Safety invariant

No connection may be silently attached to a retired source, and no live connection may be deliberately closed by optional correction. Emergency and maintenance drains retain their existing deadlines and authority.

The source cell is the authority for physical sockets and admission state. Durable cloud state is the authority for assignment, attempt generation, reservation, and fencing. Database activity leases are supporting evidence and cleanup state; an expired lease alone is never proof that a socket is gone.

## Ordered cutover

1. The director claims one eligible correction attempt under the existing assignment and migration locks, reserves target capacity, and records a monotonic assignment epoch and source cell incarnation.
2. Before changing the assignment, the director asks the source cell to enter an **idle-cutover gate** for that exact host, epoch, and attempt. The source atomically marks the host as cutover-pending and rejects new client admissions with a retryable wrong-cell response. Existing emergency/auth behavior remains unchanged.
3. The source drains only the admission pipeline: accepts already in progress finish or reject through the normal reservation cleanup path; pending attachments and control requests are allowed to finish or reach their bounded timeout. Existing data sockets are not closed by this optional gate.
4. The source returns a snapshot containing its current control generation, active data socket count, pending admission count, pending control-work count, and the cutover attempt/epoch. The source returns **idle** only when all required counts are zero and the snapshot still belongs to the gate. A stale generation, changed attempt, or reopened admission invalidates the snapshot.
5. The director rechecks the same attempt, assignment epoch, source incarnation, target reservation, capability, and safety state while holding the authoritative locks. It commits the new assignment and epoch in one transaction only after the source reports idle. The old assignment cannot win a concurrent update.
6. The director tells the source to complete the gate. On success the source closes the desktop control socket cleanly; the desktop reconnects through the new assignment. On failure, timeout, source loss, or stale authority, the director aborts the attempt, releases target reservations, and tells the source to reopen admissions. A lost response is recovered by replaying the exact attempt, never by guessing.
7. The desktop’s next control or client connection resolves the durable assignment. Older desktops do not advertise the correction capability and stay on the legacy path. A newer desktop talking to an older director uses the existing optional-field/HTTP-400 fallback and remains on the legacy path.

## Race and failure requirements

- A new admission arriving during the gate is rejected or completes before the idle snapshot; it can never attach after the snapshot and before assignment commit.
- A phone reconnecting during cutover retries against the director and receives either the old assignment after an abort or the new assignment after commit.
- The desktop control socket is counted as cutover work until the source explicitly closes it; it is not treated as a client data socket.
- Pending connection reservations, attachment timers, control RPCs, and cleanup callbacks are bounded and must release their ownership on every response, rejection, timeout, close, abort, and retry.
- Source loss is reported as unavailable/unverifiable and follows ordinary recovery; it is not evidence that the user’s remote process exited.
- One open correction attempt per host remains enforced. Concurrent director instances must claim and recheck idempotently.
- Emergency drains, auth expiry, generation replacement, and capacity protection bypass optional idle correction and retain current behavior.

## What is removed versus reused

Remove optional live-source retention, source splice preservation, multi-hour retained-control renewal, and rollback that restores a live generation after target activation. Reuse the existing assignment locks, attempt generations, target reservations, capability negotiation, source admission registry, assignment resolution, retry pacing, and emergency drain paths. Keep explicit attempt and epoch fences because they protect the cutover race even when no data socket is retained.

## Validation before implementation review

Add deterministic tests for: two clients becoming idle; a new admission during the gate; a control request completing during the gate; delayed and duplicate gate replies; target registration failure; source loss; director restart; stale assignment epoch; old desktop/new cloud; new desktop/old cloud; emergency drain during a pending cutover; and a client reconnecting immediately before and after assignment commit. Use real TCP WebSockets for at least the admission race and failed-cutover recovery. Prove that no data socket is duplicated, no mutation is replayed, and aborted attempts reopen admissions.

## Rollout gates

Keep correction disabled by default. Before enabling, require cloud and cell revisions that implement the gate, packaged desktop compatibility checks, Linux/Windows and SSH transport checks, production preview and capacity evidence, and an approved bounded cohort. Measure reconnect errors, failed/aborted cutovers, time spent waiting for idle, source admission rejections, and actual application latency against an unchanged cohort. Disabling new claims must leave in-flight gates recoverable.

## Open decisions

- Whether the desktop should proactively close its control socket after an idle signal or let the source close it as part of cutover.
- The retryable response/status for admissions rejected during cutover.
- Maximum gate wait and the policy for a host whose clients remain connected indefinitely.
- Whether correction should be attempted only after a mobile-triggered disconnect or on the desktop’s normal measurement refresh cadence.
