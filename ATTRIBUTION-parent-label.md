# Defect B — a parent row displays its child's text

Base: `779667c1e7` (origin/main at time of writing).
Status: **diagnosis complete, mechanism NOT chosen.** Do not pick a fix before reading
"Constraints" and the reference findings that will be appended to this file.

## Observed

A structured agent session (native chat) ran a subagent. The **parent** sidebar row displayed text
that the **subagent** had written. The parent itself had produced nothing since launching the child.

## Verified mechanism

Read directly at `779667c1e7`:

1. `src/main/claude/claude-structured-journal-translation.ts:142-144`
   ```ts
   if (envelope.parentToolUseId) {
     subagents.observeChildActivity(envelope.parentToolUseId)
   }
   ```
   A frame belonging to a **child** is noted and then **falls through** — no early return, and no
   producer tag is attached to the item that is subsequently appended. The child's assistant prose
   is appended to the *parent's* journal, indistinguishable from the parent's own output.

2. `src/shared/structured-agent-session-projection.ts:253-269`
   ```ts
   export function latestStructuredAgentSessionAssistantMessage(
     items: readonly AgentJournalRenderItem[]
   ): string {
     for (let index = items.length - 1; index >= 0; index -= 1) {
       const body = items[index]?.body
       if (body?.kind === 'message' && body.role === 'user') {
         return ''
       }
       if (body?.kind === 'message' && body.role === 'assistant') {
   ```
   Scans **all** items backwards, stopping only at a user-role message. There is **no filter on
   which agent produced the item**, so the newest assistant prose may be the child's.

   Note the function's own docstring says *"The newest assistant prose in the latest user turn."*
   The code has no such scoping. **Comment and implementation disagree about what "assistant"
   means** — that gap is the defect.

3. That value becomes the row's `lastAssistantMessage` and is rendered as the row's secondary line.
   Confirmed present as a live field: `orca worktree ps --json` returns `lastAssistantMessage` on
   183 of the agent rows on this machine.

## Reported but NOT personally verified

From a code map; confirm before relying on any of it:

- `src/shared/structured-agent-session-live-turn.ts:81-95` — `activeStructuredAgentSessionToolCall`
  reportedly scans backwards for the newest running `tool-call`, also without a parentage filter,
  so a **child's** running tool can be shown on the **parent** row (`toolName` / `toolInput`).
- `src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx:43-51` — reported render
  site for the secondary line.

## Constraints — read before proposing anything

- `docs/reference/agent-status-store.md:55-62`: readers keep **only** presentation policy;
  precedence is decided once, at write time.
- `docs/reference/agent-status-store.md:5-8`: do **not** remove the renderer bridge or its
  publication filters in this slice — they still carry native-chat child rows.
- **Test gap, not test coverage:** no test in
  `src/shared/structured-agent-session-projection.test.ts` feeds subagent-parented items into
  `projectStructuredAgentSessionStatusSummary`; every case there uses a single flat conversation.
  So this leak is untested in both directions. A regression test is part of the fix.

## Design question this defect raises

Is the right fix to **filter at the reader** (projection skips child-produced items), or to
**attribute at the producer** (journal items carry the producing agent, and every projection is
scoped by it)? The second is the larger change and likely also resolves defects A and C.

Do not assume. The reference research appended to this file should decide it — and note that a
reader-side filter would be the second reader-side policy in a subsystem whose own documentation
says readers should hold none.

## Your task

1. Re-baseline against current `origin/main`; this file may be stale.
2. Confirm or refute the above **at source**. Do not trust this document.
3. Propose a mechanism. Prefer fixing the architecture over adding a guard. State plainly whether
   your fix removes the bug class or just this instance.
4. State what the fix does to defects A (`attr-parent-recency`) and C (`attr-child-clock`).
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
