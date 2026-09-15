# C1 review-and-fix acceptance report

## Exact stack

- Base read and reviewed: `origin/main` at `36ef93a64f3a`.
- C1 implementation/review HEAD: `be012b9a56e103b244d7d0794c651337ade444e3`.
- Scoped commits: `21317312aa` (reducer correctness and conformance coverage) and
  `be012b9a56` (bounded inventory membership lookup).
- Intended dependency stack, not cherry-picked into this checkout: C2
  `e0db1ef036` and C5 `9b41a2df3a`; coordinator must use their successors if
  either lane advances. C7/C10 remain downstream consumers of this contract.

## Functional correctness

The reducer now keeps root outcome, finite joined-child membership, resident
background residency, dispatch receipt/outcome, execution verdict, interrupt
delivery/acknowledgement, and recovery custody as separate facts. Complete
inventories are required before a completed root can produce a successful
dispatch outcome (`src/shared/agent-turn-lifecycle-reducer-transitions.ts:148-189`),
late joined-child evidence invalidates previously complete membership knowledge,
and anonymous or ordinary start-less completion cannot create a turn. Root
supersession and inventory replacement resolve only finite joined work
(`src/shared/agent-turn-lifecycle-reducer-operations.ts:173-199`); an authoritative
execution exit also resolves resident work, including resident work attached to
an already-unresolved superseded turn (`src/shared/agent-turn-lifecycle-reducer-execution.ts:14-24`).

The reducer clones owner/evidence state at boundaries, bounds all retained
collections, records capacity/conflict integrity issues, and retains rejected
event identities so repeated stale delivery cannot create unbounded work.

## Architecture fit

The implementation is one pure shared reducer façade (`src/shared/agent-turn-lifecycle.ts`)
with no parallel launch/resume reservation or reader-side precedence rule. It
does not write a structured journal; structured journal ownership remains a
dependency of the host integration. The mechanism is intentionally host/run/
attachment-attributable and keeps process execution verdict, turn outcome,
joined children, persistent background, pending interrupt, and dispatch receipt
orthogonal.

The review found and fixed two reducer-level architectural defects rather than
adding guards: resident work was previously rewritten to `unresolved` whenever a
new root superseded a foreground turn, and a late child start could leave a
complete inventory trusted. The implementation still cannot claim end-to-end
architecture because the production owner admission, provider evidence ingress,
restart source, and host replication lanes are not present in this checkout.

## Concrete precedent and deviations

The private reference inspection was used only to compare ownership, delivery,
and lifecycle mechanisms; source names and private locations are intentionally
omitted here. The reducer follows the relevant mechanism of one host-owned,
identity-keyed lifecycle fold with bounded replay identities and explicit
unknown outcomes. It does not claim full precedent alignment: provider-specific
ancestry extraction, durable restart hydration, transport capability negotiation,
and remote host composition remain in C2/C5/C7 and were not implemented here.

## Production entrypoint map

- Reducer contract and façade: `src/shared/agent-turn-lifecycle-contract.ts`,
  `src/shared/agent-turn-lifecycle.ts`.
- Reducer event dispatch: `src/shared/agent-turn-lifecycle-reducer.ts` and
  `src/shared/agent-turn-lifecycle-reducer-events.ts`.
- Inventory/recovery/execution transition modules:
  `src/shared/agent-turn-lifecycle-reducer-inventory.ts`,
  `src/shared/agent-turn-lifecycle-reducer-recovery.ts`, and
  `src/shared/agent-turn-lifecycle-reducer-execution.ts`.
- Current checkout production-caller audit: `rg` finds no non-test caller of
  `reduceAgentTurnLifecycle`, `createAgentTurnLifecycleState`, or
  `readAgentTurnLifecycleSnapshot`. Therefore this HEAD is not a production
  vertical slice until the execution-host hook store binds the committed/adopted
  owner and routes provider evidence through this façade.
- Required integration dependencies: C5 must publish its committed/adopted
  attachment binding at the existing owner lifecycle boundary; C2 must route
  provider evidence, terminal-record recovery, interrupt acknowledgement, and
  complete inventory into this reducer; C10 must consume these owner/membership
  facts; C7 must replicate the host projection without creating a competing
  semantic reducer. No duplicate implementation was added here.

## Acceptance cases

Passed by deterministic reducer tests (19 tests):

- child-before-parent completion and late completion retaining the newer current
  turn;
- root dispatch independent of resident background work;
- resident monitor survives root supersession and remains active after interrupt
  acknowledgement;
- resident monitor is resolved on authoritative execution exit, including after
  foreground supersession;
- complete inventory reconciliation, failed joined-child folding, and uncertainty
  for settled inventory rows without an outcome;
- late joined-child start invalidating a previously complete inventory;
- dispatch receipt gating and preserving an observed receipt during abandon;
- attributable terminal-record recovery versus anonymous ordinary completion;
- interrupt input delivery kept separate from acknowledgement;
- bounded recovery expiry versus explicit abandon;
- replay dedupe/stable completion identity, defensive snapshots, owner cloning,
  malformed identity rejection, and duplicate inventory membership rejection.

Missing or blocked end-to-end cases:

- provider-specific nested `codex exec`/ancestry and unrelated same-pane evidence;
- Stop-followed-by-continuation semantics (C2 must distinguish tentative provider
  Stop from committed outcome before reducing it);
- production owner registration/emitter proof, lifecycle cleanup on pane retirement,
  restart/replay hydration, terminal-record/inventory recovery feeds, and failed
  checkpoint delivery;
- mixed-version publication and session-tab/direct-SSH transport negotiation;
- C10 membership/adoption, C7 host composition/replication, and Electron/manual QA.

These are explicit integration gaps, not closure claims for unused APIs.

## Validation and performance evidence

- `ORCA_BACKGROUND_LAUNCH=1 node_modules/.bin/vitest run --config config/vitest.config.ts src/shared/agent-turn-lifecycle-reducer.test.ts` — 19 passed.
- `ORCA_BACKGROUND_LAUNCH=1 node_modules/.bin/tsc --noEmit -p config/tsconfig.node.json` — passed.
- `ORCA_BACKGROUND_LAUNCH=1 node config/scripts/check-changed-code-quality.mjs` — 0 new findings across 13 changed files.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm tc:node` — passed before final direct-tool rerun; the pnpm executable rewrote an unrelated lockfile entry, which was removed and is not part of this stack.
- Performance audit: reducer work is bounded by the configured caps; complete
  inventory membership reconciliation now uses a `Set` for linear membership
  checks (`src/shared/agent-turn-lifecycle-reducer-inventory.ts`) rather than a
  nested array scan. No polling, IPC, subprocess, renderer subscription, or
  journal write path changed in C1.

## Next QA scenarios

Run production-hook fixtures with a real committed/adopted owner on native,
headless, WSL, SSH relay, folder workspace, and git worktree paths. Exercise
out-of-order root/child evidence, nested child ancestry, Stop continuation,
restart with a surviving provider process, complete-inventory cursor continuity,
execution exit into a surviving shell, duplicate dispatch acknowledgement,
failed journal/checkpoint writes, and both mixed-version directions including
session tabs and direct SSH. Manual Electron QA remains assigned to the separate
QA worker and must use the Electron skill with hidden/background launch policy.

