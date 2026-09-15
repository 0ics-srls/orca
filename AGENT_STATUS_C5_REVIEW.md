# C5 review-and-fix acceptance report

## Exact review HEAD

Production and test changes are in commit `c07fe106523f2ea5ac740706e7f77afaf1ce6ae2` (the report artifact is added after this code snapshot). The branch was re-baselined against `origin/main` at `ffc331212c38e9d94af09df74f03afa6e63a0717`; no copied briefs, HTML plans, or private reference notes are part of the commit.

## Failure mechanism and architecture judgment

The existing atomic owner registry minted a correct run and attachment binding, but launch paths did not stamp that binding into the child environment and hook transports discarded it. A pane, cwd, title, or inherited launch token therefore accepted status before a subject was established; nested or delayed emitters could update the same row.

The fix extends the existing `ClaimedAgentPtyOwnerRegistry.ensure` callback and committed/adopted lifecycle. Main/daemon/relay spawn callbacks stamp `ORCA_AGENT_STATUS_RUN_ID` and `ORCA_AGENT_STATUS_EXECUTION_ID`; hook builders and plugins carry an untrusted claim; the receiving host resolves it against one live owner and only then stamps canonical `runId`, `executionId`, and `providerAlias`. No second launch/resume registry, status journal, or reader precedence guard was added.

Functional correctness and architectural fit are separately judged as partial: exact owner claims, mixed-version status retention, stale mismatched-claim suppression, replacement identity clearing, and transport propagation are covered. Full process-ancestry proof for inherited descendant environments, provider reset alias chains, child-run construction, manual discovery, and C10 committed-membership publication remain bounded gaps owned by the follow-on lifecycle slices; this report does not certify those cases.

## Production entrypoint map

- `src/main/daemon/terminal-host-agent-session-claim.ts:23-34`: daemon create/attach stamps the binding only inside `ensure` spawn.
- `src/main/ipc/pty/runtime/spawn-execute.ts:81-92`: local execution-host spawn stamps the binding before provider spawn.
- `src/relay/pty-handler.ts:1763-1774`: relay lower-host spawn stamps the same binding; lower-host ownership remains authoritative.
- `src/main/providers/local-pty-launch-helpers.ts:9-16`, `src/main/pty/wsl-orca-env.ts:80-88`, `src/main/ssh/ssh-remote-cli-host-passthrough.ts:77-84`, and `src/relay/remote-cli-env.ts:5-14`: binding environment survives local, WSL, SSH, and relay boundaries.
- `src/shared/agent-hook-listener/hook-envelope.ts:50-105`: six-field packed metadata remains compatible while binding headers are decoded and merged; eight-field input is accepted for transition compatibility.
- `src/main/agent-hooks/agent-status-execution-binding-resolver.ts:21-39`: exact pane/worktree/source/run/attachment matching against one live owner; ambiguous matches resolve to null.
- `src/main/agent-hooks/server/server-status-binding.ts:24-90`: untrusted claims are resolved before projection; mismatched delayed claims are suppressed, missing claims retain a known subject for mixed-version peers, and replacements clear prior pane context.
- `src/main/agent-hooks/server/server-status-identity.ts:55-63`: verified identity is published to the IPC projection for C10 and later readers.

## Acceptance cases

Passed:

- Exact live owner binding yields canonical run and execution IDs.
- Mismatched and cross-surface claims are rejected by the resolver.
- Delayed mismatched claims cannot rewrite a confirmed row.
- Legacy/mixed-version events with no claim can update state while retaining a verified subject.
- Replacement bindings clear the reused pane's prior execution context.
- Adoption/replacement and lower-host ownership remain on the existing atomic owner lifecycle (inherited from the foundation tests).
- Old six-field packed metadata remains accepted; new raw-JSON metadata uses separate encoded binding headers so an old listener can still parse its six fields.
- Local, daemon, relay, WSL, SSH, spool, Windows and provider/plugin emission paths carry the binding where their launch environment has an owner binding.

Missing or bounded:

- A binding inherited by a nested same-provider process is attachment proof, not ancestry proof; a nested process without provider parent evidence is unresolved rather than assigned a child run.
- Provider reset aliases are not yet accumulated into a durable alias chain; the current row publishes the verified provider alias only.
- Hook events racing owner promotion can arrive while the registry reservation is not yet live; there is no bounded pending-claim queue or owner-commit callback in this slice.
- Manual/tmux/cron/Telegram discovery and provider-specific emitter ancestry are not implemented here.
- C10 has not yet published `started/status-not-observed` membership from committed/adopted owners, and C7 has not cut every reader over.
- Independent fresh review workers were dispatched by the prior supervised turn but returned `outcome_unknown`; this is disclosed as a confidence gap, not treated as a clean independent review.

## Validation

- `ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/agent-hooks/installer-utils.test.ts src/relay/remote-cli-env.test.ts src/main/opencode/hook-plugin-module-contract.test.ts src/main/pi/agent-status-extension-source.test.ts src/main/hermes/hook-service.test.ts` — 5 files, 109 passed, 3 skipped.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/agent-hooks/server-authority-evidence.test.ts src/main/agent-hooks/server-observation-provenance.test.ts src/main/agent-hooks/server-status-listener-fanout.test.ts src/main/agent-hooks/server-ingest-remote.test.ts src/main/agent-hooks/server-hook-http-ingest.test.ts src/main/agent-hooks/server-transport-interference.test.ts src/relay/agent-hook-envelope-publication.test.ts src/relay/agent-hook-server.test.ts src/relay/agent-hook-integration.test.ts` — 9 files, 115 passed.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm test src/shared/agent-hook-listener-transport.test.ts src/main/agent-hooks/spool.test.ts src/main/agent-hooks/installer-utils-remote.test.ts src/main/agent-hooks/managed-hook-owner-identity.test.ts src/main/pty/wsl-orca-env.test.ts src/main/ssh/ssh-remote-cli-host-passthrough.test.ts` — 6 files, 110 passed.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/daemon/terminal-host-agent-session.test.ts src/main/ipc/pty-controller-spawn-admission.test.ts src/main/providers/ssh-pty-provider-spawn.test.ts src/relay/pty-handler-spawn-admission.test.ts src/main/runtime/remote-agent-session-host-authority.integration.test.ts` — 5 files, 78 passed.
- Resolver and status regressions: `src/main/agent-hooks/agent-status-execution-binding-resolver.test.ts` (2 passed) and `server-ingest-terminal-status.test.ts` (16 passed).
- `ORCA_BACKGROUND_LAUNCH=1 pnpm tc:node` — passed.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm run check:code-quality:changed` — passed with 0 new findings across changed files.
- `git diff --check` — passed.
- Electron/manual UI validation was not run; the assigned QA worker must use the Electron skill and hidden/CDP validation rules.

## Performance and reliability evidence

The hot-path change is a bounded owner lookup over the registry's capped live-owner set (capacity 1024); no polling, timer, subprocess, retry loop, or unbounded scan was added. Hook metadata adds two bounded identity strings and preserves the existing 5 MiB spool cap and transport frame limits. Reliability coverage is deterministic lower-layer tests for local/daemon/relay/SSH/WSL propagation, mixed-version metadata, owner replacement, and stale-claim suppression; the pending-promotion race and full ancestry proof remain explicit gaps above.

## Next QA scenarios and dependencies

The next QA pass should exercise a committed claimed launch, adoption, replacement, and exit-before-registration on native, daemon, WSL, direct SSH, and relay hosts; send hooks before and after owner promotion; run a nested same-provider child sharing the parent environment; replay a stale old binding after pane reuse; and verify IPC rows preserve run/execution IDs across reconnect. C10 must consume `owner.statusBinding` for committed/adopted membership without minting a new identity; C1/C2 must own turn/outcome reduction; C7 must complete host composition and reader cutover. No force-push, merge, PR, sibling checkout, or external UI action was performed.
