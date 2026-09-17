# Defect A — an idle parent row is stamped "now" by its child's work

Base: `779667c1e7` (origin/main at time of writing).
Status: **diagnosis complete, mechanism NOT chosen.** Do not pick a fix before reading
"Constraints" and the reference findings that will be appended to this file.

## Observed

A structured agent session (native chat) ran a subagent. In the sidebar:

- The **parent** row was stamped **now** — while the parent was idle. The user had written
  nothing since launching the child.
- The **child** row, which was the thing actually working, was stamped **14m**.

The idle row looked live; the live row looked stale.

## Verified mechanism

Every line below was read directly at `779667c1e7`.

1. `src/main/native-chat/agent-session-journal/journal-reducer.ts:69`
   ```ts
   state.lastActivityAt = Math.max(state.lastActivityAt, row.ts)
   ```
   Advances for **every** non-epoch journal row, with no regard for which agent produced it.

2. `src/main/native-chat/agent-session-wire/structured-agent-session-status-feed.ts:264`
   ```ts
   updatedAt: journal.lastActivityAt() || this.deps.now()
   ```
   So `summary.updatedAt` is a journal-wide clock.

3. `src/renderer/src/components/native-chat/StructuredAgentSessionStatusBridge.tsx:192-196`
   ```ts
   stateStartedAt:
     desired.state !== 'done' && current?.state === desired.state
       ? current.stateStartedAt
       : summary.updatedAt,
   ```
   For a `done` (idle) row the first conjunct is false, so `stateStartedAt` is **re-stamped to
   `summary.updatedAt` on every publish**.

4. `src/shared/agent-completion-time.ts:35-44` — `agentEntryCompletionAt` returns
   `entry.stateStartedAt` for a non-interrupted `done` entry.

5. `src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx:59-66` —
   `getCompactAgentTime` displays `lastEnteredDoneAt(agent)` for a done row.

**Chain:** child emits a frame -> row appended to the *parent's* journal -> `lastActivityAt` bumps
-> `summary.updatedAt` bumps -> bridge re-stamps the idle parent's `stateStartedAt` ->
row renders "now".

## The two-writer disagreement

There are two writers for the same pane key, and they use **different rules**:

- Renderer (above): `desired.state !== 'done' && current?.state === desired.state`
- Main, canonical — `src/main/agent-hooks/server/server-ingest-structured.ts:65`:
  ```ts
  stateStartedAt: priorStatus?.state === state ? priorStatus.stateStartedAt : summary.updatedAt,
  ```

Main has **no `!== 'done'` guard**, so main's canonical row holds a stable idle `stateStartedAt`
while the renderer's copy does not. They are kept apart by publication *filters*, not by having one
writer.

Note `agent-completion-time.ts:33` documents the invariant the bridge breaks — `stateStartedAt` is
described as *"unmoved by same-state tool/prompt pings"*.

## Constraints — read before proposing anything

- `docs/reference/agent-status-store.md:55-62`: *"Precedence is decided once, at write time...
  Readers never re-adjudicate... Readers keep only presentation policy and user facts."*
  A renderer-side writer owning a `stateStartedAt` rule is already outside that boundary.
- `docs/reference/agent-status-store.md:184-187`: the renderer bridge still writes these rows
  because forwarding from main *"would give one pane key two writers"*; removing that filter is
  step one of PR 2.
- `docs/reference/agent-status-store.md:5-8`: **do not remove the renderer bridge or its
  publication filters in this slice** — they still carry native-chat child rows.

So the clean architectural fix and the current slice boundary are in tension. Resolving that
tension is part of the task, not something to paper over.

- An existing test **pins the defective behavior**:
  `src/renderer/src/components/native-chat/StructuredAgentSessionStatusBridge.test.tsx:446-477`
  asserts an idle row's `stateStartedAt` advances (`now-100` -> `now-50`). Fixing this means
  changing that test — say so explicitly rather than quietly editing it.
  `:481-493` asserts the non-done case holds steady, confirming the guard is done-only.

## Your task

1. Re-baseline against current `origin/main` before doing anything; this file may be stale.
2. Confirm or refute the chain above **at source**. Do not trust this document.
3. Propose a mechanism. Prefer fixing the architecture over adding a guard beside the existing one.
   State plainly whether your fix removes the bug class or just this instance.
4. State what the fix does to defects B (`attr-parent-label`) and C (`attr-child-clock`) — a single
   attribution mechanism may resolve all three, which is the preferred outcome.
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
