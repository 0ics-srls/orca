# Defect C — a working child row shows its spawn time, not its activity

Base: `779667c1e7` (origin/main at time of writing).
Status: **diagnosis complete, mechanism NOT chosen.** Do not pick a fix before reading
"Constraints" and the reference findings that will be appended to this file.

## Observed

A subagent row that had been **working for 14 minutes** displayed **"14m"**. Read as a recency
column ("last seen 14 minutes ago") it looks stale, while the child was in fact the only thing
doing work. Its idle parent, meanwhile, read "now" — see `attr-parent-recency` (defect A).

## Verified mechanism

Read directly at `779667c1e7`:

`src/renderer/src/components/sidebar/worktree-subagent-child-rows.ts:41-47`
```ts
const startedAt = subagent.startedAt > 0 ? subagent.startedAt : args.parentEntry.stateStartedAt
const paneKey = subagentRowKey(args.parentEntry.paneKey, subagent.id)
const entry: AgentStatusEntry = {
  state: activeState ?? 'done',
  prompt: subagent.description ?? subagent.agentType ?? '',
  updatedAt: args.parentEntry.updatedAt,
  stateStartedAt: startedAt,
```

Three things to note:
- `stateStartedAt` is the subagent's **spawn** stamp.
- `prompt` (the row's label) is the subagent's description — this row is *correctly* attributed.
- `updatedAt` is **borrowed from the parent**, which is itself polluted by defect A.

So "14m" is literally "14 minutes since spawn". It is correct-by-field and **cannot be fixed at the
reader** — the number the row wants to show does not exist.

## Reported but NOT personally verified

From a code map; confirm before relying on any of it:

- `src/shared/agent-session-background-task-wire.ts:18-35`, `:26` — the child's wire type reportedly
  has **no activity field at all**; the comment is said to read *"Host epoch ms when the task was
  first observed, so clients render elapsed."*
- `src/main/claude/claude-background-task-tracker.ts:245` (`startedAt: existing?.startedAt ?? this.now()`)
  and `:303` (`startedAt: existing.startedAt`) — first-observed stamp reportedly preserved across
  every roster update, **deliberately**.
- `src/shared/agent-status-types.ts:80-81` — *"Timestamp (ms) when this subagent was first observed."*
- `src/renderer/src/components/dashboard/agent-finished-timestamp.ts:14-16` — `lastEnteredDoneAt`
  reportedly returns `null` for a non-done subagent row, so the row falls through to `startedAt`.

**Verify the "deliberately preserved" claim first.** If the stamp is load-bearing for stable
first-seen sort, then adding a second field is right and mutating this one is wrong.

## The actual question

This is **not** a rendering bug. It is a missing field: there is no per-child last-activity
timestamp anywhere on the wire. So the options differ in kind from defects A and B:

- Add a last-activity field to the child wire type (and keep `startedAt` for elapsed/sort), or
- Derive child activity from producer-attributed journal items — which is exactly the mechanism
  defect B may introduce. **If B attributes items to their producing agent, this defect may be
  solved for free.** That is the preferred outcome; check it before designing anything bespoke.

Note the display question is separate and also unresolved: for a *working* child, is the right
label an elapsed duration ("working 14m") or a recency ("last active 3s ago")? A duration may be
the honest reading of a spawn stamp and may need no new field at all. Decide this explicitly.

## Wire compatibility — mandatory

Any new field crosses the client/host boundary. Follow
`docs/reference/remote-wire-compatibility.md`: a new **optional** field is safe; changing what the
host publishes reaches old clients even with no wire change. Mixed versions are the normal state.
Say which category your change is in.

## Constraints

- `docs/reference/agent-status-store.md:55-62`: readers keep **only** presentation policy.
- `docs/reference/agent-status-store.md:5-8`: do **not** remove the renderer bridge or its
  publication filters in this slice — they still carry native-chat child rows.
- Existing tests pin the spawn stamp; check them before changing behavior:
  `src/renderer/src/components/sidebar/worktree-subagent-child-rows.test.ts:19-54` (asserts
  `row.startedAt === 20` across a freshness matrix) and
  `src/renderer/src/components/sidebar/useWorktreeAgentRows.test.ts:728-768`.

## Your task

1. Re-baseline against current `origin/main`; this file may be stale.
2. Confirm or refute the above **at source**. Do not trust this document.
3. Decide first whether defect B's mechanism already supplies this. Only design a new field if it
   does not.
4. Propose a mechanism; prefer architecture over a guard. State whether it removes the bug class.
5. Mark every claim VERIFIED or UNVERIFIED. Cite file:line.

---

# Reference findings

Five independent implementations were reviewed. Projects are deliberately not named here; describe
any conclusion in repo-native terms only. Every mechanism below was read at source and verified.

## Converged — all five agree

1. **A child's activity never touches the parent row's lifecycle state, label, or timestamp.**
2. **Attribution happens at ingestion (the producer boundary), never as a reader-side filter.**
3. **Exactly one writer of a row's status/recency.** None of the five keeps two writers apart with
   publication filters. They make the second writer *impossible*.
4. **Child -> parent rollups do exist** — but they roll up *status* or a *count*, never a label and
   never a timestamp, and each is explicit and documented.
5. **The row label is a stored title derived from the user's own prompt** — never a backward scan
   for the newest assistant message.

## Closest architectural match (same platform: Electron, host-service process + renderer sidebar
## that nests parent and subagent rows)

- Subagent hook events are routed to a **separate roster at ingestion, before any store write**.
  The ingestion comment reads: *"Subagent activity is not the terminal's lifecycle: no chime, no
  status change, no session id capture."*
- The store method recording subagent events is documented *"Never touches the parent binding's
  lifecycle state."*
- The renderer **derives** status on every read inside a `useMemo` and **stores nothing**.
- The state-entry stamp is preserved server-side as
  `prior !== undefined && !sessionChanged ? prior.startedAt : occurredAt`.
  **There is no done-state special case.** That is the shape of Orca's *main* canonical writer
  (`server-ingest-structured.ts:65`), not the renderer bridge's.

## How the references make a second writer impossible

- One reference's generic update API **structurally omits** the status/recency fields, so the type
  itself forbids a second writer; a lint rule confines cache writes to owner modules.
- One consolidated *"ten independent writers across six slices"* into a single registry writer and
  recorded the decision as an architecture decision record.
- One gates client updates behind a monotonic sequence check and replaces **whole rows**, so a
  client cannot mutate an individual field.

## Where the references DIVERGE — do not claim precedent here

The child clock (defect C) has **no single answer**:
- one shows **no timestamp at all** on the desktop row, carrying liveness via status + derived counts;
- one shows a **live-ticking elapsed duration** that freezes at completion;
- one carries a true **advancing per-child progress field**.

All three do quarantine the spawn stamp from display. So C has several legitimate answers — choose
one with stated reasons; you may not justify it by precedent alone.

## Material deviation to disclose (repo-native terms, for the eventual PR body)

> Orca keeps two real writers of one status row apart with publication filters. Every reference
> implementation examined removes the possibility of a second writer rather than suppressing its
> traffic.

## Feasibility fact established in Orca

The producer already has the attribution and discards it:
- `src/main/claude/claude-structured-item-translation.ts:57` already parses
  `parentToolUseId: claudeText(frame.parent_tool_use_id)`.
- `src/main/claude/claude-structured-journal-translation.ts:143-144` uses it only for
  `observeChildActivity(...)`, then drops it; the item is journaled with no producer trace.
- The journal schemas carry **no producer field at all** — zero hits for
  `parentToolUseId|agentId|parentAgentId|producer|subagentId` in
  `src/shared/agent-session-journal-schemas.ts` and `src/shared/agent-session-journal-types.ts`.
- A canonical subagent id already exists next door:
  `src/main/claude/claude-subagent-roster.ts:121` (`this.ids.canonical(parentToolUseId)`).

So attributing at the producer means **persisting a value we already compute and throw away three
lines later** — not plumbing a new one end to end.
