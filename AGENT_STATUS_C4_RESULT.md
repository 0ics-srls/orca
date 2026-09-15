# C4 integration implementation result

## Scope delivered

This branch establishes the first C4 integration slice on the execution host:

- Added one `ManagedAgentIntegration` descriptor per existing managed vendor. Install, refresh, remove, async-remove, and status projections now derive from that descriptor, while legacy tuple exports remain compatible for existing callers. The lifecycle loop consumes descriptors, so operation lists cannot silently diverge.
- Made Hermes lifecycle operations profile-aware. Explicit `--profile`, `-p`, and `--profile=` launch arguments take precedence over `active_profile`; profile names are validated before path construction. Install/status/remove use the selected profile home, and YAML updates preserve existing top-level and nested comments while retaining atomic unchanged-write behavior.
- Added a bounded Codex JSON stdin runner for POSIX launchers. It returns after a complete JSON value even when the caller keeps stdin open, never falls back to an unbounded `cat`, and emits neutral `{}` output on fail-open paths on POSIX and Windows.
- Classified oversized listener payloads with `AgentHookRequestTooLargeError`. Main and relay listeners return JSON HTTP 413 with the fixed one-megabyte limit, pause the request before responding, and do not forward the rejected event.
- Resolved OMP profile/config roots before `PI_CODING_AGENT_DIR` exists, validated profile names, and propagated effective XDG data/state/cache roots from shell startup or inherited process environment into local PTY and relay-spawned environments.

## Evidence

- Focused C4 integration run: 10 files, 97 passed, 2 skipped.
- Broader integration run: 13 files, 185 passed, 4 skipped.
- Additional hook/transport run: 6 files, 105 passed, 7 skipped.
- Final profile/source-scope run: 2 files, 9 passed.
- `pnpm tc:node` passed.
- `pnpm run check:code-quality:changed` passed with zero new findings, including type-aware, React Doctor, and casting-safety checks.
- `pnpm exec oxfmt --check` passed for all changed/new implementation and test files.
- `git diff --check` passed.

Representative coverage includes managed lifecycle projection, stale-script refresh, profile selection and comment preservation, open-stdin Codex execution, outside-Orca fail-open output, oversized relay requests, listener size bounds, OMP shell/XDG resolution, and existing Windows/WSL hook command contracts.

## Cases not closed by this branch

These remain intentionally unresolved and are not claimed as fixed:

- OpenCode V1/V2 loader migration and a verified current vendor adapter were not changed; Auggie has no verified vendor API and remains unimplemented.
- Overlay-only agents (`opencode`, `mimo-code`, `pi`, `omp`, and `prime-agent`) are not yet represented in the managed installer/status registry. Their per-launch overlay paths remain outside the descriptor lifecycle.
- Artifact version markers, loader acceptance evidence, round-trip delivery health, and a general integration-health state model were not added.
- Claude running-session account ownership/hot switching remains pending the execution binding contract. This branch does not select credentials through trust state, restart a live process, or claim a credential change succeeded.
- Remote Hermes profile launch plumbing needs an execution-host launch context from the remote PTY path; the local/profile filesystem resolver is implemented and tested.
- Direct executable-argv/fish reproductions for STA-5230 and STA-3936, and historical Kimi/OMP/Prime behavior, need additional vendor/runtime evidence.
- Rerouted completion, readiness, interaction, and publication cases remain with their owning batches.

## Required sibling integration

- C5 must publish the run/attachment binding contract so integration scope and account roots can be resolved per execution without a second identity or reservation mechanism.
- C10 must consume that binding for launch membership/adoption; C4’s descriptors must not become a competing launch registry.
- C1 provides the canonical turn reducer; C2 consumes it for provider recovery. C4 adapters must publish normalized provider facts into that reducer rather than adjudicating completion independently.
- C3 owns readiness and prompt-delivery evidence; C6 owns exact-attachment execution evidence; C7 owns host composition, remote publication, and replica cutover. Remote status must not be inferred from this branch’s local filesystem reads.

## Judgments

- **Architecture fit:** The descriptor projection removes the fragmented local lifecycle ownership and keeps vendor-specific operations behind one host-side contract. Profile and environment resolution now follow launch scope. The full host registry, overlay integration, artifact provenance, and account-binding architecture are still pending the contracts above.
- **Functional correctness:** The implemented slices are covered by executable tests and the stated validation gates. They handle bounded input, fail-open output, profile-safe paths, comment-preserving updates, and local/relay OMP environment propagation. Unsupported vendor/API and account-transition behavior remains unverified.
- **Private precedent limitations:** The implementation matches the useful mechanism of a single descriptor-driven lifecycle and scoped, atomic materialization. It does not yet match a complete verified-integration health model, vendor-owned transport migration, or host-authoritative remote registry; those are recorded as deviations rather than inferred from passing tests.
- **Validation:** All listed checks passed on the current branch. Electron/mobile UI validation was not applicable; no app window was launched.
