# Daemon stop authority: verified scope and remaining unsafe kills

A target daemon can confirm that a PTY is absent while another preserved daemon makes the router's aggregate inventory fail. This is a concrete conditional explanation for a failed local close in [#19018](https://github.com/stablyai/orca/issues/19018). The report does not establish an unavailable legacy daemon, so it does not prove this was the reporter's exact ordering.

The isolated candidate scopes verification to a previously established adapter and stamped PTY incarnation. It checks authenticated daemon identity, current routing, and provider/incarnation ownership before completing cleanup. **It is not a shipped fix.** The proof deliberately shows why completion checks alone cannot make shutdown safe.

## Run

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/daemon-stop-owner-authority/reproduce.mjs /tmp/daemon-stop-owner-authority.json
```

Dependencies must already be installed. The script runs the current source and an isolated candidate through Vitest transforms, with eight verification controls and three unsafe-kill controls per phase: 22 tests total. Source hashes and unique replacement anchors reject drift. Temporary configs/results are removed; product source stays unchanged. `candidate-transforms.json` is review material for the unshipped idea, not an installable patch. The candidate is transpiled for the proof and does not yet add the provider interface types required for a product change.

The fixtures use actual daemon servers, control/stream sockets, adapters, router, runtime controller, and runtime state. Child processes are controlled test doubles. Fault injection restarts endpoints or creates another client's session at a selected shutdown boundary; it does not model how frequently this occurs in production. No application window is shown. The fixtures reuse the daemon test harness from [#21000](https://github.com/stablyai/orca/pull/21000).

## Verified outcomes

| Scenario                                                                     | Current code                 | Isolated candidate                                 |
| ---------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| Healthy target and legacy inventory                                          | Stop verified                | Stop verified                                      |
| Established target; unrelated legacy endpoint unavailable                    | Verification fails           | Target absence verifies                            |
| Same raw ID on two generations, established authoritative target incarnation | Aggregate cannot verify      | Target verifies; foreign session survives          |
| No established target route                                                  | Verification fails           | Still fails                                        |
| Same-adapter successor admitted after stop                                   | Successor remains owned/live | Same                                               |
| Captured daemon identity changes before shutdown                             | Existing shutdown proceeds   | Refuses before shutdown                            |
| Actual restart during verification                                           | Verification fails           | Refuses replacement identity                       |
| Another adapter's successor admitted during stop                             | Successor remains owned/live | Same; completion fence prevents clearing successor |

Three additional controls demonstrate unresolved destructive boundaries:

1. **Restart during shutdown.** After capture, the daemon restarts on the same endpoint and another client creates a new incarnation with the same raw ID. Adapter shutdown reconnects and kills that replacement. Current code reports success; the candidate reports failure only after the replacement was force-killed once. A completion check is too late.
2. **Unknown route with a collision.** The requested incarnation belongs to a legacy daemon, but no route is established. Router fallback kills the current daemon's different incarnation once. Both versions return false while the intended legacy session survives. A false result does not establish safe kill selection.
3. **Replacement inside the same daemon.** Another client closes the original and creates a new incarnation under the same raw ID before the pending kill. Daemon identity stays unchanged. Both versions kill the replacement once and report success. Endpoint identity cannot fence this case.

`results.json` records these outcomes without random incarnation IDs. This is a lifecycle/authority proof, not a retained-heap measurement. It does not infer process death from missing diagnostics, a lost socket, or a missing route.

## Reuse and wire boundary

The generic provider shutdown contract already accepts `expectedIncarnationId`. The local daemon adapter does not pass it. More importantly, the daemon wire does not implement it:

- `types.ts` `KillRequest` carries only `sessionId` and `immediate`.
- `daemon-request-router.ts` forwards those fields, cancels pending preparation and clears input before `host.kill`.
- `terminal-host.ts` selects the current live session by raw ID; it does not compare an expected incarnation.
- Protocol 36 and its hello exchange have no incarnation-fenced kill capability. Expected-incarnation support in `inspectProcess` and `createOrAttach` does not make a later kill atomic.

A narrower endpoint-reconnect safeguard can reuse `getLastAuthenticatedDaemonIdentity` and `sameEndpointIdentity`: capture before the per-session shutdown lock, check after `ensureConnected`, and recheck after awaited checkpoint work immediately before issuing the kill. `DaemonClient.request` writes the current socket without reconnecting. That safeguard can reject a replacement daemon without changing the wire; it cannot stop same-daemon cross-client replacement.

Atomic incarnation-aware kill requires host enforcement and mixed-version negotiation, including a conservative policy for older owners. Unknown routes also require explicit target authority before destructive work. Neither broader change is implemented here.

The unfenced kill request and raw-ID host selection are also present in reported `v1.4.197`. The complete historical version is not replayed; this artifact records the current checkout and the narrowly transformed candidate.
