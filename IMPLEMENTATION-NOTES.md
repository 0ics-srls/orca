# Launch visibility implementation notes

## Outcome

Implemented issue #19154 Bug A changes A, B, C, and the section D tests. A structured native-chat create now emits one phase-timed trace span, the pending creation surface names the selected agent while chat starts, and a 30-second deadline claims the existing single-shot legacy fallback without turning the creation into an error. Cancellation wins the race, unknown-outcome recovery remains intact, and a structured publication that arrives after a deadline fallback is retired instead of leaving a second surface.

`LAUNCH-VISIBILITY-PLAN.md` remains the user's untracked scratch file and was not modified.

## Files changed

### Main process tracing

- `src/main/observability/agent-session-instrumentation.ts`: added the closed create-phase vocabulary, the unsampled `agentSession.create` wrapper, phase timing, and overlap-aware unattributed timing. The attributes contain no branch, path, prompt, content, or session identifiers.
- `src/main/native-chat/agent-session-wire/structured-agent-session-attach-orchestration.ts`: wraps create-intent attaches once and records lease reconciliation, recovery resolution, settlement retry, and owner probing.
- `src/main/native-chat/agent-session-wire/structured-agent-session-attach-flow.ts`: records owner reservation/acquisition and carries the recorder through the attach flow.
- `src/main/native-chat/agent-session-wire/structured-agent-session-acquisition.ts`: carries the recorder into provider acquisition and records option restoration.
- `src/main/native-chat/agent-session-wire/structured-agent-session-adapter.ts`: adds the optional, host-local phase recorder to provider acquisition input.
- `src/main/claude/claude-structured-acquisition-launch.ts`: owns the extracted Claude auth-settle and launch-resolution phase so touched production files remain below 300 lines.
- `src/main/claude/claude-structured-session-acquisition.ts`: records Claude auth settle, spawn, init, option restore, and publication phases.

### Renderer visibility and bounded fallback

- `src/renderer/src/lib/pending-worktree-creation.ts`: adds `starting-chat` and derives “Starting <agent> chat…” from the pending request's catalog agent, with neutral fallback.
- `src/renderer/src/lib/worktree-creation-structured-session.ts`: sets the phase immediately before launch, consumes the deadline fallback as a usable surface, and retires late structured sessions/tabs.
- `src/renderer/src/lib/structured-agent-launch-settlement.ts`: adds the injectable 30-second deadline race, cancellation precedence, deadline settlement, and late-publication hook.
- `src/renderer/src/lib/structured-agent-session-launch.ts`: generalizes the single fallback claim, clears the structured focus/draft/outbox before a deadline fallback, and preserves the former claim name as a compatibility alias.
- `src/renderer/src/lib/structured-agent-session-launch-callers.ts`: makes the existing fallback group transition reject already terminal outcomes, retaining one fallback owner.
- `src/renderer/src/lib/structured-agent-session-launch-registry.ts`: owns launch registry/status state extracted from the launch executor to keep the touched production module under 300 lines.
- `src/renderer/src/lib/launch-work-item-direct-agent-routing.ts`: handles `deadline-then-legacy` exactly like the existing usable refusal fallback.

### Tests

- `src/main/observability/instrumentation.test.ts`: checks one span, the closed phase attribute keys, unattributed time, and absence of sensitive attribute names.
- `src/main/native-chat/agent-session-wire/structured-agent-session-acquisition-options.test.ts`: pins phase-recorder propagation into the provider adapter.
- `src/renderer/src/lib/pending-worktree-creation.test.ts`: checks agent-specific and neutral starting-chat labels.
- `src/renderer/src/lib/structured-agent-launch-settlement.test.ts`: covers deadline, healthy-fast launch, refusal/deadline single-shot behavior, cancellation precedence, and late result handling with an injected clock.
- `src/renderer/src/lib/structured-agent-session-launch-deadline-fallback.test.ts`: checks that deadline fallback abandons the structured focus intent and staged draft before opening, split into a focused module to keep the existing launch suite within its line limit.
- `src/renderer/src/lib/worktree-creation-structured-session.test.ts`: checks phase ordering/outcomes and late session/tab retirement while preserving the fallback surface.
- `src/renderer/src/lib/launch-work-item-direct-agent-routing.test.ts`: checks that direct work-item launches consume the deadline fallback surface.

## Plan verification

The renderer claims were accurate at the starting revision: `WorktreeCreationPhase` was at `pending-worktree-creation.ts:23`, its label function at lines 172–185, the unbounded await at `structured-agent-launch-settlement.ts:94`, and the existing claim/caller implementation at `structured-agent-session-launch.ts:318` and `structured-agent-session-launch-callers.ts:218–228`.

The main attach call-site locations were stale/incomplete in the plan: the actual orchestration, flow, and acquisition files are under `src/main/native-chat/agent-session-wire/`, not directly under `src/main/`. Their stated approximate line ranges had also drifted. The Claude acquisition file is `src/main/claude/claude-structured-session-acquisition.ts` as expected.

The plan asked to add instrumentation alongside the worktree helpers, but `src/main/observability/instrumentation.ts` was already 331 lines at the starting revision. The agent-session instrumentation therefore lives in its own concretely named module rather than extending an already over-cap file.

No other factual plan claim used by the implementation was wrong.

## Deadline choice

`STRUCTURED_AGENT_LAUNCH_DEADLINE_MS` is `30_000` ms. The named constant has a `// Why:` comment: the healthy rig opens the chat in about 1.5 seconds, while provider acquisition already permits 15 seconds for auth settling plus 10 seconds for initialization. Thirty seconds stays above those legitimate bounds while placing a finite ceiling on a stalled launch. Tests inject both the duration and clock and never sleep.

Deadline settlement is `deadline-then-legacy`, not an error. It completes with the legacy surface, so worktree creation clears normally. The existing `visibilityUnknown`/manual Retry path is unchanged for genuinely unknown outcomes.

## Targeted tests

Final command, with each test path passed as a separate argument:

```sh
pnpm test src/main/observability/instrumentation.test.ts src/main/native-chat/agent-session-wire/structured-agent-session-acquisition-options.test.ts src/main/claude/claude-structured-session-adapter.test.ts src/renderer/src/lib/pending-worktree-creation.test.ts src/renderer/src/lib/structured-agent-launch-settlement.test.ts src/renderer/src/lib/structured-agent-session-launch.test.ts src/renderer/src/lib/structured-agent-session-launch-deadline-fallback.test.ts src/renderer/src/lib/worktree-creation-structured-session.test.ts src/renderer/src/lib/launch-work-item-direct-agent-routing.test.ts
```

Reported result: **9 test files passed (9); 140 tests passed (140)**.

An earlier pre-audit run reported 5/5 files and 80/80 tests; the final set was expanded to cover recorder propagation, the launch focus-intent transition, the direct launch consumer, and the Claude acquisition refactor.

## Ablation matrix

Every implementation ablation used an absolute `/tmp` backup, changed the implementation under test, observed a red targeted test, restored by copying from that backup (never checkout), and compared pre/post SHA-256 checksums. All restore checks matched.

| Implementation change reverted | Targeted red result |
| --- | --- |
| Renamed `agentSession.create` away from the expected span name | Observability test expected one matching record and found zero. |
| Disabled the `starting-chat` label branch | Agent-specific test got “Fetching base branch…” instead of “Starting Codex chat…”. |
| Disabled the `starting-chat` label branch | Neutral fallback test got “Fetching base branch…” instead of “Starting chat…”. |
| Removed the phase update immediately before launch | Worktree session suite had 5 failures: accepted, refused, cancelled, unknown, and deadline paths all observed zero phase-update calls. |
| Disabled the deadline branch | Never-settling launch test failed to settle. |
| Forced the launch/deadline race to choose the deadline | Healthy-fast test received the legacy deadline result instead of `structured`. |
| Disabled the deadline branch | Refusal/deadline single-shot test failed. |
| Removed both deadline cancellation checks | Cancellation test returned visibility-unknown instead of cancelled. |
| Disabled late-result notification after deadline fallback | Settlement late-result retirement test failed. |
| Replaced the launch state's deadline cleanup with callers-only settlement | Focused deadline test: 1 file failed and 1 test failed; the expected structured-focus abandonment had zero calls. |
| Replaced the worktree late-session hook with a no-op | Worktree suite observed no structured session close after late publication. |
| Removed `deadline-then-legacy` from the direct work-item switch | Direct routing test received `undefined` instead of the fallback surface. |
| Removed phase-recorder propagation into `adapter.acquire` | Acquisition-options test showed the adapter input lacked `recordPhase`. |

Backup paths used included:

- `/tmp/native-chat-agent-session-instrumentation.ts.bak`
- `/tmp/native-chat-pending-worktree-creation.ts.bak`
- `/tmp/native-chat-worktree-creation-structured-session.ts.bak`
- `/tmp/native-chat-structured-agent-launch-settlement.ts.bak`
- `/tmp/native-chat-structured-agent-session-launch-resume.ts.bak`
- `/tmp/native-chat-worktree-creation-structured-session-resume.ts.bak`
- `/tmp/native-chat-launch-work-item-direct-agent-routing-resume.ts.bak`
- `/tmp/native-chat-structured-agent-session-acquisition-resume.ts.bak`
- `/tmp/native-chat-worktree-creation-all-exits.ts.bak`
- `/tmp/native-chat-structured-agent-session-launch-pr-ablation.ts.bak`

## Live Electron validation

Used the Electron skill with `ORCA_BACKGROUND_LAUNCH=1`, an isolated user-data directory, hidden renderer, and Playwright CDP only. No OS-level input or visible-window activation was used.

- CDP identity confirmed branch `brennanb2025/native-chat-launch-visibility` and this exact worktree.
- The real pending-creation store rendered “Starting Claude chat…” in both the sidebar row and full panel. The full panel showed `5s`, proving the elapsed counter continues during `starting-chat`.
- Screenshot: `/tmp/native-chat-launch-visibility-starting-chat.png`.
- A real structured Claude session create against the imported workspace completed successfully in **1.064s**.
- Its isolated `logs/main.trace.ndjson` contained exactly one `agentSession.create` row, with all eleven expected phase keys and `agent_session.create.unattributed_ms: 27`.
- The live span carried only `kind` and timing attributes; it carried no branch, path, prompt, content, or session identity.
- The real session was closed successfully, the Playwright session was closed, and only the recorded process group launched for this validation was terminated. Ports 9334 and 5174 were no longer listening afterward.

The live check rendered the real creation component from a pending store record and separately ran a real structured create. It did not create a disposable git worktree end to end, because the isolated profile had only the user's shared Orca repository and doing so would leave or destructively remove a real branch/worktree. It also did not hold a real provider beyond 30 seconds to force the production deadline; the deadline and late-publication paths are covered with injected-clock tests instead.

## Final gates and hygiene

- `pnpm exec oxfmt --write <changed code/test files>`: passed; the focused deadline test module was formatted again after the line-limit restructure.
- `pnpm run check:code-quality:changed`: passed; 0 new code-quality findings across 21 files, 0 type-aware findings, 0 React Doctor findings.
- Final `pnpm tc`: passed across the node, CLI, and web TypeScript projects with exit code 0. Registry fallback was not needed on the final run.
- The first commit attempt's hook found the existing launch test suite one line over its 800-line budget; the new deadline test was moved to `structured-agent-session-launch-deadline-fallback.test.ts`, and its targeted test, full targeted set, typecheck, and changed-code gate were rerun successfully.
- `git diff --check`: passed.
- LF/NUL scan: no CR or NUL bytes in changed TypeScript/Markdown files.
- All touched production files are below 300 lines; no max-lines disable or per-file bump was added.
- `git status --short pnpm-lock.yaml`: empty after every final pnpm command. `pnpm-lock.yaml` is unchanged.
- No stash, checkout, rebase, install, full-suite run, or whole-repository format was performed.

## Residual risks

- The real 30-second deadline and post-deadline provider publication were not forced in Electron. Deterministic injected-clock tests cover the race, single-shot claim, cancellation precedence, usable fallback, focus cleanup, and late retirement, but a genuinely slow live provider could still expose integration timing not present in the rig.
- Late structured cleanup is intentionally best effort. If both session close and tab retirement RPCs fail after a deadline, the legacy surface remains usable, but the late host session may persist until ordinary reconciliation/cleanup.
- During the multi-day interruption, local `main` advanced beyond this branch's starting revision. Per instruction, this worktree was not rebased or checked out; integration against the newer tip remains future merge/rebase validation.
