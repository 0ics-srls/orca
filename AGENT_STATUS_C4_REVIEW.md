# C4 integration review and fix

## Exact revision

- Review base: `f5dc3f120b1455c21b1541520e8bf33b7d68dedb` (`feat(agent-hooks): scope integrations and bound runners`).
- Review fix commit: `224681c82918c57697a070f8ef4acb627ea33faf` (exact HEAD before this report-only amend).
- Copied launch brief and triage HTML remain untracked and are intentionally excluded.

## Findings and fixes

### Fixed

- The local lifecycle registry had already converged install/refresh/remove/status, but SSH/WSL remote installation still maintained a second vendor list. `MANAGED_AGENT_INTEGRATIONS.installRemote` now owns the remote installer projection for every existing remote-capable vendor; `remote-managed-hook-installers.ts:26-35` derives its allowlisted list from that projection. This removes remote list drift while retaining the fail-closed allowlist and cancellation behavior.
- Hermes profile scope was implemented in the local service but was not reachable from aggregate launch or remote lifecycle paths. Install options now carry launch environment/command, local Hermes PTY launch materializes the selected profile (`src/main/ipc/pty/host-env/assembly.ts:86-101`), remote installer options carry a validated profile, and relay startup derives a bounded `active_profile` value (`src/main/agent-hooks/managed-hook-runtime.ts:79-124`). Unsafe profiles return a structured error before mutation.
- Hermes lifecycle scope now travels through descriptor install/status/remove operations. Scoped status/removal resolves the same profile root, global removal safely discovers managed profile homes and persisted custom roots, and user config is not created during cleanup.
- Relay Pi/OMP source resolution now preserves origin and `createIfMissing` semantics. Explicit OMP profiles and configured launch targets materialize missing homes, while user-provided source overrides remain fail-closed; the relay no longer rejects a first-launch profile solely because its directory is absent.
- Added executable coverage for descriptor forwarding, remote profile materialization and rejection, active-profile relay installation, local launch profile wiring, and aggregate remote registration.

### Review findings not fixed in this scope

- Overlay-only integrations (`opencode`, `mimo-code`, `pi`, `omp`, `prime-agent`) still use per-launch overlay managers rather than the managed hook status registry; adding them to the hook-status enum would create a competing lifecycle/status contract. Their production overlay entrypoints were inspected and remain separately owned pending a shared integration-health contract.
- A verified OpenCode V2 loader/event contract and an Auggie hook API were not available in the repository or current vendor evidence. No speculative adapter was added. Existing OpenCode V1-compatible default/server materialization remains covered by its module contract tests.
- Account binding is not delegated to trust state: existing Codex per-home and Claude managed-account launch paths remain authoritative. Running Claude hot-switch/re-auth and explicit account transition UI were not changed; this branch does not claim a live process changed credentials.
- Artifact currency/loader evidence/delivery health is still not a durable general model; status remains based on each service's existing install state.

## Production entrypoint map

- Local aggregate lifecycle: `src/main/agent-hooks/managed-agent-hook-controls.ts` consumes `MANAGED_AGENT_INTEGRATIONS` and forwards launch scope.
- Local Hermes launch: `src/main/ipc/pty/host-env/assembly.ts:86-101` calls `HermesHookService.install` only for an explicitly selected Hermes launch, with launch environment and command; failures warn and do not gate spawn.
- Hermes lifecycle scope: `src/main/agent-hooks/managed-agent-hook-registry.ts` and `src/main/agent-hooks/managed-agent-hook-controls.ts` pass the same env/command scope to install/status/remove; `src/main/hermes/hook-service.ts` discovers managed profiles and bounded persisted custom roots for global cleanup.
- Remote aggregate lifecycle: `src/main/agent-hooks/remote-managed-hook-installers.ts:26-81` projects all remote-capable descriptors, preserving host allowlists and abort checks.
- Relay/headless lifecycle: `src/main/agent-hooks/managed-hook-runtime.ts:79-124` reads a bounded active profile and passes it to the same remote installer engine.
- Hermes filesystem scope: `src/main/hermes/hook-service.ts:75-165` validates profile names and writes profile-local config/plugin files atomically through existing config helpers.
- Hook transport: existing bounded body reader/413 handling and Codex bounded JSON runner from the reviewed base remain unchanged by this fix.

## Acceptance cases

### Passed

- One descriptor projection drives local and remote installer membership for the 14 existing managed hook vendors.
- Hermes explicit `--profile`, `-p`, `--profile=` local launch resolution; active profile relay installation; remote profile installation; unsafe profile rejection without writes.
- Aggregate launch environment/command forwarding and selected Hermes PTY materialization.
- Hermes per-profile status/remove isolation and global managed-scope cleanup.
- Relay explicit OMP profile/custom-root materialization when the source directory is missing, with user overrides still refused.
- Existing focused lifecycle, transport, runner, overlay, and profile suites remained green.

### Missing or bounded

- Explicit Hermes `--profile` over an already-running remote PTY is not inferred from a remote shell command; relay startup uses the execution host's bounded active profile. A future per-launch remote binding should supply the command/profile directly.
- OpenCode V2, Auggie, overlay registry unification, general integration-health evidence, and Claude live-account hot-switch remain unresolved as documented above.
- Electron/mobile QA is not applicable to these backend integration changes; no app window was launched.

## Validation commands and results

- `ORCA_BACKGROUND_LAUNCH=1 pnpm vitest run src/main/agent-hooks/managed-agent-hook-controls.test.ts src/main/agent-hooks/remote-hook-service-installers.test.ts src/main/agent-hooks/managed-hook-runtime.test.ts src/main/ipc/pty-spawn-env-terminal-basics.test.ts` — 84 passed.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm vitest run src/main/agent-hooks/remote-hook-service-installers.test.ts src/main/agent-hooks/managed-agent-hook-controls.test.ts src/main/hermes/hook-service.test.ts` — 56 passed.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm vitest run src/main/agent-hooks/managed-hook-runtime.test.ts src/main/agent-hooks/remote-hook-service-installers.test.ts` — 36 passed.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm vitest run src/main/ipc/pty-spawn-env-terminal-basics.test.ts` — 28 passed.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm vitest run src/main/hermes/hook-service.test.ts src/main/agent-hooks/managed-agent-hook-controls.test.ts src/main/agent-hooks/remote-hook-service-installers.test.ts src/main/agent-hooks/remote-hook-platform-output.test.ts src/relay/plugin-overlay-env.test.ts src/relay/plugin-overlay.test.ts` — 89 passed.
- `pnpm tc:node` — passed.
- `pnpm run check:code-quality:changed` — passed with zero new findings.
- `pnpm exec oxfmt --write ...` on changed files and `git diff --check` — passed.

## Performance and safety evidence

- Active-profile relay reads are bounded by a 512-byte stat gate; profile names are limited to 128 safe characters before path construction.
- Hermes scope index paths are absolute, control-character-free, capped at 4 KiB each/16 KiB total, and cleanup only removes files carrying the Orca-managed marker.
- No retry loop, timeout relaxation, unbounded read, or host contention benchmark was added. Existing hook body and JSON structural caps remain in force.
- The Hermes launch installer is best-effort and never blocks PTY spawn on bookkeeping/config failure.

## Next QA scenarios

- Manual SSH and WSL Hermes launch with explicit profile command and profile switch while two panes run concurrently; verify each pane's hook config path and status attachment.
- Mixed-version relay/client profile installation, relay restart with a changed active profile, and malformed/oversized profile marker recovery.
- Settings disable after two Hermes profiles plus a custom `HERMES_HOME`; verify scoped removal, persisted-root cleanup, and preservation of user-authored config.
- Vendor-version matrix for OpenCode loader/API changes and a verified Auggie hook contract before adding adapters.
- Account transition tests for Codex system-default and Claude managed account re-auth, including pending/failure/rollback and existing-process attribution.

## Dependencies and intended stack

- Base is `origin/main` at `ffc331212c38e9d94af09df74f03afa6e63a0717` through existing branch commit `f5dc3f120b`.
- This fix does not require sibling code cherry-picks. It preserves the existing C5 launch-binding seam, C1 reducer ownership, C2 recovery ownership, and C7 host/replica publication boundary; no competing launch registry or semantic reducer was introduced.
