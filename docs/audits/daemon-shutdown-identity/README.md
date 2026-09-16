# Endpoint identity checks are insufficient across close retries

This is a focused companion to [the daemon-owner authority proof](../daemon-stop-owner-authority/README.md). Its adapter-only candidate prevents a pending shutdown from crossing to a replacement daemon. **It remains unpublished:** the full explicit-close path retries the refusal and kills the replacement anyway.

## Reproduce

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/daemon-shutdown-identity/reproduce.mjs /tmp/daemon-shutdown-identity.json
```

Dependencies must already be installed. The script checks source hashes and exact replacement anchors, runs the actual source and an isolated candidate, records results, and removes temporary files. It never alters product source or launches a UI. The fixture uses real daemon sockets and history locks/checkpoints with controlled subprocesses. It reuses the actual runtime/socket harness from [#21000](https://github.com/stablyai/orca/pull/21000).

There are nine scenarios per phase, 18 tests total. `results.json` preserves the recorded run; use a separate output file to rerun.

## Adapter result

The candidate captures the adapter's last authenticated daemon identity before entering its per-session history lock. It checks identity after `ensureConnected`, then again after awaited checkpoint work immediately before sending the kill. A fresh lazy client adopts its first authenticated identity. The existing `sameEndpointIdentity` comparator checks PID, startup timestamp, and launch nonce. No wire change is involved.

| Adapter scenario                                          | Current code           | Candidate                         |
| --------------------------------------------------------- | ---------------------- | --------------------------------- |
| Healthy immediate shutdown                                | Succeeds               | Unchanged                         |
| Healthy shutdown with final checkpoint                    | Succeeds               | Unchanged                         |
| Reconnect to the same daemon                              | Succeeds               | Unchanged                         |
| First shutdown from a lazy, unauthenticated adapter       | Succeeds               | Unchanged                         |
| Daemon replaced before shutdown connects                  | Kills replacement once | Refuses; replacement remains live |
| Daemon replaced and reauthenticated during checkpoint     | Kills replacement once | Refuses; replacement remains live |
| Daemon replaced while shutdown waits behind history lock  | Kills replacement once | Refuses; replacement remains live |
| Another client replaces the raw ID inside the same daemon | Kills replacement once | Still kills replacement once      |

The last control remains unsafe because endpoint identity does not identify an individual PTY incarnation. Atomic incarnation-aware kill is a separate missing-wire boundary documented in the companion proof.

## Full explicit close defeats the first refusal

The ninth case invokes the actual `runtime.closeTerminal`, runtime controller, and adapter:

1. The close captures the original terminal and enters stop-and-wait.
2. The daemon restarts; another client creates a different incarnation under the same raw ID.
3. The candidate rejects the first shutdown. `stopAndWaitPtyFromRuntimeController` turns that rejection into `false`.
4. `stopExplicitlyClosedTabPtys` invokes the generic fallback kill. This is a new adapter invocation, which captures the newly authenticated daemon identity.
5. The replacement receives one graceful kill. The close still returns false/unverifiable.

The baseline sends one immediate kill and reports success. The candidate replaces that with an initial refusal followed by one graceful kill. Both leave zero live processes. Therefore an adapter refusal alone is not an end-to-end fix.

## Caller inventory

Source-confirmed retry paths beyond the actual explicit-close reproduction:

- `worktree-teardown.ts:123` serializes stop attempts by raw ID, but a failed attempt permits the next registration source to try again. Runtime, provider-inventory, and registry sweeps launch together. `worktree-pty-surface-sweeps.ts` invokes provider shutdown in the latter two sources.
- `missing-worktree-terminal-reconciliation.ts:116` reaches that coordinator during background reconciliation. Worktree removal and folder-workspace teardown also use it.

Negative coverage:

- `stopExactTerminalsForWorktree` throws on a false stop result without a fallback kill.
- `sleepResolvedWorktreeTerminals` collects failures and reports/refuses without a fallback kill.
- `stopTerminalsForWorktree` itself returns false; retries arise in the outer coordinator.
- `renderer-kill.ts` propagates a non-missing-session shutdown failure while retaining ownership, with no immediate retry.
- Both spawn-persistence rollback paths call shutdown once, then clear bookkeeping even when it fails; they have no immediate second shutdown.

The background retry ordering is source-confirmed here, not replayed by the socket fixture. The restart timing is controlled fault injection, not a claim about incident frequency or the reporter's exact sequence.

## Existing authority boundaries

`ptyIncarnationById` and runtime PTY records preserve the admitted incarnation, but `RuntimePtyController.kill` accepts only a raw ID and `stopAndWait` returns only a boolean. The fallback therefore carries no immutable shutdown authority. `shutdownProviderAndDetectExit` captures an incarnation only to filter EXIT notifications; it does not pass it to shutdown.

The daemon adapter's `sessionIncarnations` map tracks admitted spawn/attach incarnations, while its last authenticated endpoint identity is adapter-wide and changes on reconnect. The router's established route/incarnation is invalidated when daemon identity changes. These are useful inputs for a future scoped operation, but none is currently a retry-stable shutdown token. `getLastAuditObservation` is endpoint-level evidence, not per-session destructive authority.

A safe follow-up must retain the original target authority across every retry or classify the identity refusal as non-retriable throughout the relevant caller chain. It must also preserve older daemon compatibility and avoid inventing process death from loss of contact. This artifact implements neither policy and makes no retained-heap claim.
