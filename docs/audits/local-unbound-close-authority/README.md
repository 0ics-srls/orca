# Direct local empty-tab close prototype

Audit of the remaining `#17344` path after acknowledged host close was fixed.
All candidate changes are isolated Vite overlays. They are intentionally unsafe examples,
not proposed product patches.

The later [explicit local retirement action](../local-empty-tab-retirement/README.md), published as [#21113](https://github.com/stablyai/orca/pull/21113), fixes the narrow never-bound, positive-topology-epoch path. The rejected tombstone/receipt designs below remain useful ownership counterexamples; they are not the implementation of that fix.

## Existing trigger

`createTab(...,{activate:false})` creates a local row with `ptyId:null`, generation 0 and an empty
layout. After some host retirement has advanced the repository topology revision, direct
renderer `closeTab` removes the row but records no closed-tab tombstone and has no provider ID
to retire. The normal session write is rebased against host membership and the row returns on
restart. This is already proven in `docs/audits/local-tab-close-rebase`.

## Reuse candidate

The existing `ClosedTerminalTabTombstone` travels through full, patch and unload persistence.
An optional `unboundLocalTab` identity could distinguish a locally captured empty tab from a
legacy SSH close marker. Main would validate the prior host row's creation time, generation,
current pin, absence of leaves/bindings/incarnations/sleeping sessions and the current local
execution host. It can reuse `closeTerminalTabInWorkspaceSession` and topology advance before
the ordinary membership rebase. Tombstone-only patches also need terminal normalization.

The fixture intentionally limits this to initial empty layouts. A mounted but currently unbound
pane is not established never-bound ownership. No process is killed, no SSH absence is treated
as exit, and remote partitions do not execute the proposed local consumer. Legacy markers
without the optional identity authorize no new host operation.

## Blocker in this naive candidate

Latest pin or successor checks alone are insufficient for a persisted request. A refused marker
must not later become new authority after a pin is removed. Keeping prior observed local markers
through older full writes handles ordinary retries, but the existing shared map has a 500-entry
cap and SSH acknowledgements remove entries. A refused local marker can be evicted by newer
markers, then reappear after SSH acknowledgements free capacity. The last test requires that
the old request remain refused and deliberately exposes this unsafe candidate.

No second unbounded ledger should be introduced. The existing per-repository topology epoch
can fence repeated requests only if the close carries an observed epoch and every admitted
attempt advances it, including refusal; this adds admission/acknowledgement/retry work for
concurrent closes and is not implemented here. A new per-tab consumed-close identity would
also require an explicit persistence/compatibility design. Do not promote the current overlay.

A smaller alternative under test is a host-authored rejected-intent receipt on the **retained
tab row**, preserved when older renderer metadata is rebased. Successful retirement already
has the existing membership epoch, so no receipt needs to outlive a removed tab. A refused
intent's receipt would live with the still-present exact tab instead of the transport map,
and transport TTL/cap pruning could not erase it. This needs a new optional row field, schema
and host-field merge contract. `receipt-candidate.ts` implements this alternative only in the
ignored overlay. It strips renderer-provided receipt values, preserves the host's prior value
by tab UUID, records the greatest refused close timestamp, and advances the existing topology
revision to publish that host-authored refusal. A fresh later explicit close can still succeed.
This is not a production fix: the additional clock/replacement controls below now prove
remaining correctness failures in this draft.

Host resolution must be stricter than `connectionId === null`: the shared folder connection
view intentionally reports a paired-runtime folder as local. The prototype first rejects an
explicit non-local folder execution host and uses the existing strict repository resolver for
ordinary worktrees. Unresolved/ambiguous owners remain outside this authority.

## Commands

The portable runner reproduces all four exact case sets and checks expected process exits,
timeouts, and pass/failure counts. It never changes product files.

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/local-unbound-close-authority/reproduce.mjs
```

It writes `results.json` with source hashes and four named phases: `baseline21`, `candidate21`,
`receipt27`, and `clock30`. The 27-case phase explicitly disables the three later clock/identity
controls; the 30-case phase includes them. The historical 27-case pass is not a safety approval.

The actual renderer Store and main Store use temporary isolated persistence. No Orca window,
shell, PTY or external host is launched. Product source remains unchanged.

## Observed results

| Source                                      | Cases | Passed | Failed |
| ------------------------------------------- | ----: | -----: | -----: |
| Current product                             |    21 |     13 |      8 |
| Naive tombstone-map receipt                 |    21 |     20 |      1 |
| Receipt on retained tab row                 |    27 |     27 |      0 |
| Row receipt with clock/replacement controls |    30 |     27 |      3 |

All eight product failures are repo/folder close persistence through full/patch/marker-only/unload
writes. The naive candidate's sole failure is replay after cap eviction and SSH marker
acknowledgement. The six extra row-receipt cases cover persistence/reload, old full writes,
forged incoming receipt values, a fresh later close, binding refusal followed by becoming unbound,
and moving the original local tab between workspaces. The consolidated results preserve expected failures and process statuses without local file paths.

The `clock30` phase adds controls for a new explicit close in the same millisecond, after a
wall-clock rollback, and after a same-UUID/new-creation-time replacement. All three fail:
the timestamp-only receipt suppresses a legitimate later action. `closedAt` must remain an
expiry timestamp, not a monotonic action identity. A safe receipt needs separately sequenced
intent identity and exact row incarnation ownership.

Simply preserving a receipt only while incoming `createdAt`/`generation` match the prior row
is insufficient: the current membership rebase spreads candidate row metadata and protects only
the prior PTY binding, so stale candidate identity fields could erase its receipt. A monotonic
receipt therefore requires an explicit host identity/merge contract, not just a conditional
spread. No such change has been made.

A one-shot optional action on the existing session patch IPC, acknowledged as applied/refused,
may be a smaller design than repeatedly interpreting persisted markers as authority. It could
carry the captured empty-row identity and use the same latest-owner/pin checks, while full and
unload snapshots never replay old actions. No IPC extension is implemented in this prototype.

Remaining review points: duplicate UUID ambiguity, sender clock rollback/fresh-close sequencing,
receipt preservation across all Store write paths, no widening to mounted/reserved panes, and
mixed-version schema behavior. Current tests do not establish that an empty persisted layout
proves no provider admission is in flight; this work retires row metadata and requests no process
death. It does not estimate retained RSS or attribute an observed OOM incident.
