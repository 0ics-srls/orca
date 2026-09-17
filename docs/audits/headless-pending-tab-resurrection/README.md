# Headless pending-tab resurrection

An initially unbound, persisted terminal tab can return after a successful mobile close if its activation is still creating the first PTY. The close durably removes the tab; the delayed fresh spawn then admits its binding as new host membership and republishes the same tab. This is a reachable conditional explanation for the symptom in [#21066](https://github.com/stablyai/orca/issues/21066), whose reporter used headless Linux `orca serve` and mobile on **v1.4.201**. The report does not establish that its tabs were unbound or activating when closed.

A tab with an existing persisted PTY binding has a different outcome: the stable-owner admission fence rejects the late reattach with `terminal_pane_owner_changed`, preserving the close. The diagnostic asserts both outcomes. No product fix is included.

## Reproduce

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/headless-pending-tab-resurrection/reproduce.mjs
```

An optional output path leaves the checked-in results untouched. The runner verifies 31 current source hashes, applies historical patches only in temporary Vite transforms, and uses the repository's cross-platform process runner. No Git access is needed to rerun it. [results.json](./results.json) records hashes, individual cases, exit codes, and timeouts.

| Source selection                | Passed | Failed |
| ------------------------------- | -----: | -----: |
| Audited working sources         |     12 |      0 |
| Named main `291b4ddd6f` overlay |     12 |      0 |
| Reported `v1.4.201` overlay     |     12 |      0 |

The two historical phases replace the 31 paths listed in [source-manifest.json](./source-manifest.json), including the actual spawn dispatcher, preflight, options, execution, stable-owner adoption, commit, and binding persistence. Other dependencies remain current. These are historical mechanism controls, not runs of either complete historical binary. Absent historical modules are rejected if imported.

## Actual execution path

1. `activateMobileSessionTab` hydrates a persisted tab and sees that its public status is not ready. It requests materialization with the existing tab/leaf identity.
2. `createRuntimeOwnedMobileSessionTerminal` calls `createTerminal` with host binding persistence enabled. The actual stable-pane claim, adoption, spawn reservation, preflight, options, and provider execution run. An unbound tab has no stable PTY owner to capture.
3. The provider reply is held while the actual `session.tabs.close` handler closes the tab. `commitHeadlessTerminalTabRetirement` advances host membership authority and synchronously flushes the removal. The RPC handler returns `closed: true`, and a new Store reads no row from disk.
4. The provider replies with exactly its requested session ID and an incarnation. The actual spawn commit has no prior binding expectation for this unbound surface. `persistPtyBinding({ hostAdmittedMembership: true })` creates the removed topology again and flushes it.
5. Materialization publishes a tab with the original tab/leaf identity. A new Store reads that row from disk.

The fixture uses the actual runtime, close RPC handler, controller spawn implementation, stable-pane reservation/adoption, Store mutation, flush, and reload. Workspace discovery, host environment installation, inventory, and the provider are inert ports. The close handler is invoked directly; mobile rendering and WebSocket framing are outside the fixture. No native PTY, shell, application window, SSH connection, or process stop is started.

## Controls and report corrections

- Both `kill: false` and `kill: true`, with inventory still listing the PTY, leave an ordinary close removed from disk, three workspace re-entries, and cold snapshot hydration. A failed kill alone does not reproduce resurrection on this path.
- Replaying the pre-close workspace session cannot restore the row: the existing membership revision fence rejects the stale topology.
- A controlled disk-flush failure rejects the close before kill; the original disk row remains. This does not claim that the existing attempted in-memory rollback fully succeeds.
- Uninterrupted activation succeeds for both initially bound and unbound tabs. A provider failure after close leaves both absent.
- A bound tab's late attach is refused after close. An unbound tab's late fresh spawn restores the row.
- A newer durable binding written during the pause survives the bound attach's refusal but is overwritten by the unbound fresh spawn. This is a Store authority control, not a second full concurrent create; pane reservations can serialize those creates.

The reporter's desktop `closeTab` / `Promise.allSettled` explanation is not the native mobile/headless path. Mobile awaits `session.tabs.close`; the pure headless branch performs durable retirement before its controller kill. There is no renderer orphan-adoption loop in ordinary headless workspace re-entry. The explicit runtime orphan-adoption API separately checks host, handle, incarnation, inventory, and surface ownership.

The blanket claim that tombstones exist only in memory is also inaccurate: legacy surface/tab tombstone fields exist in persisted state. Current normal retirement relies on host membership revision and Store reconciliation rather than writing a new perpetual tombstone. The headless projection reads persisted rows, but that alone does not bypass those upstream checks.

Finally, `terminal list` computes `orphaned` from tab/pane identity consistency, not actual membership of the persisted tab list. The ordinary-close controls therefore return `connected: true, orphaned: false` while the tab remains durably closed. That diagnostic combination is insufficient evidence for either resurrection or physical process liveness.

## Relationship to existing memory work

| Work                                                                                                                                                                        | Relationship                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#21020](https://github.com/stablyai/orca/pull/21020), [acknowledged retirement](../acknowledged-tab-retirement/README.md)                                                  | Fixes a renderer acknowledgment arriving before durable host retirement. This reproduction uses the pure headless branch and verifies retirement already completed.                                                                                                         |
| [#21113](https://github.com/stablyai/orca/pull/21113), [local empty tabs](../local-empty-tab-retirement/README.md)                                                          | Fixes a direct renderer close that never requests host retirement. Here the close request arrives and succeeds; a later host-admitted spawn writes the row again.                                                                                                           |
| [#21000](https://github.com/stablyai/orca/pull/21000), [late daemon exit](../daemon-late-exit/README.md)                                                                    | Explains one false connected-state mechanism. This reproduction requires neither late DATA nor suppressed physical EXIT.                                                                                                                                                    |
| [#21011](https://github.com/stablyai/orca/pull/21011), [queued graphs](../queued-terminal-graph-exit/README.md)                                                             | Fences a queued renderer graph against an earned exit certificate. No renderer graph or physical exit participates here.                                                                                                                                                    |
| [#21001](https://github.com/stablyai/orca/pull/21001), [#21005](https://github.com/stablyai/orca/pull/21005), [pending pane close](../pending-runtime-pane-close/README.md) | Address missing close requests while a renderer transport is attaching. The previously recorded pending web-activation exclusion has related timing, but this proof closes the parent through the actual host handler and reaches durable retirement before the late spawn. |

This artifact measures persistence and runtime ownership, not a heap or RSS slope. The small tab row alone does not explain [#19831](https://github.com/stablyai/orca/issues/19831)'s memory totals. An affected-host trace would be needed to attribute the report's particular tabs or quantify retained processes. The local fixture does not establish an SSH-specific reproduction or mixed-client transport behavior.

## Admission repair boundary

Existing `expectedBinding` / `expectedSourceBinding` checks already protect a bound owner. They require a PTY ID and cannot directly express an originally unbound surface. Existing `mayCreate: false` rejects absent tab/leaf topology, but alone cannot distinguish a same-ID replacement or a newer binding.

A repair needs to capture the original execution host, tab creation/generation, leaf, and unbound state, and validate that authority before durable binding and publication. It must allow an intentional later create, preserve sibling topology and a newer owner, and avoid inferring `exited` from a removed UI row. Existing acknowledged-retirement identity logic offers relevant checks, but its predicate deliberately accepts absent state and cannot be reused unchanged for spawn admission.

Rejecting a fresh binding through the generic spawn-commit error path currently invokes provider shutdown. That is not automatically authorized by tab absence: a reattach, same-ID replacement, or newly attached live owner needs separate custody evidence. No shutdown expansion, new tombstone registry, or wire change is proposed by this diagnostic. Any follow-up must preserve `live` / `unverifiable` / `exited` and the execution-host boundary.
