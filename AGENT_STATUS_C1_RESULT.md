# C1 result — canonical attributable turn lifecycle

## Completed

- Added the host-side `AgentTurnLifecycleEvent`, `AgentTurnLifecycleState`, and
  `AgentTurnLifecycleSnapshot` contract, with a single façade at
  `src/shared/agent-turn-lifecycle.ts`.
- Added a pure reducer that keeps root outcome, joined children, resident
  background work, dispatch receipt/settlement, execution verdict, and recovery
  custody as separate facts.
- Added attributable terminal-record recovery for a missed start. Ordinary
  unidentified or start-less completion does not create a turn.
- Added complete current-turn inventory reconciliation. Omitted active work is
  unresolved; a settled inventory row without an outcome is never promoted to
  success.
- Added separate interrupt input-written and interrupt-acknowledged evidence.
  Input delivery does not settle a turn; acknowledgement is the only interrupt
  outcome.
- Added `live | unverifiable | exited` execution verdict handling. Exit marks
  active/recovering turns unresolved and emits no successful completion.
- Added bounded recovery custody with deadline expiry and explicit abandon.
- Added dispatch-scoped settlement requiring an explicit received receipt and
  stable completion/settlement identities for replay consumers.
- Added runtime validation for owner, evidence, lifecycle IDs, timestamps,
  inventory rows, and all event variants.

## Evidence

- Focused reducer conformance: 11 tests passed.
- Shared suite: 723 test files passed, 6 skipped; 8,172 tests passed, 117
  skipped.
- `pnpm tc:node`, `pnpm tc:web`, and `pnpm tc:cli` passed.
- Changed-file code quality, type-aware quality, React Doctor, and max-lines
  ratchet passed with zero new findings.

## Commits

- `1375d66859` — `feat: add canonical agent turn lifecycle reducer`

## Handoff

C2 was sent the focused commit and import surface through its resolved Orca
terminal. The send was accepted (`accepted: true`, request
`20468472-227e-4d1b-ad0c-e6ebaf191cff`); no duplicate prompt was sent after the
terminal reported that it was already busy and could not observe a new turn.

## Architecture and correctness judgments

- **Architecture fit:** The reducer is host-scoped and attributable by run and
  concrete attachment, with orthogonal turn, child, background, dispatch,
  execution, and recovery facts. It does not add a launch registry or a second
  structured journal.
- **Functional correctness:** The reducer and validation behaviors above are
  covered by deterministic unit tests and the full shared regression suite.
- **Precedent limitations:** Prepared lifecycle implementations supported the
  mechanisms of active turn identity, stable replay identities, explicit child
  folding, and independent background residency. Their provider coverage and
  transport composition do not prove Orca's provider or remote integration;
  those remain follow-up work.

## Remaining gaps and required integration

- The contract is not yet wired into the hook server, provider normalizers,
  structured-session publishers, SSH relay, or renderer/CLI readers. C2 owns
  provider evidence and recovery adapters against this reducer.
- C5 owner-binding integration is required before production events can be
  admitted. The currently observed implementation commit is `1d3783e091` (use
  its successor if that branch advances).
- C10 membership/adoption and C7 host composition/replication must consume the
  same owner and snapshot facts; no competing reducer should be introduced.
- External exactly-once notification delivery still requires each sink's
  durable checkpoint/idempotence policy. This reducer only exports stable IDs.
- Provider-specific attribution, complete inventory availability, restart
  hydration, and direct SSH mixed-version behavior need C2/C7 conformance
  fixtures before claiming end-to-end closure.
