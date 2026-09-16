# C4 Agent Status Recovery Implementation

## Baseline and scope

- Implementation base: `b5a99462bced6871b8a1c711222bc58cff938b9f`.
- Implementation HEAD: `0200993462` (code changes; evidence report commit follows).
- Prior scoped Hermes and remote OMP fixes from `44a11f7336574452464cee23e41e2b48c949b627` are preserved by the rebased C4 commits.
- No live authentication, account mutation, Electron launch, PR, push, merge, or remote deployment was performed.

## Acceptance matrix

| Package                                 | Implementation                                                                                                                                                                                                                                     | Evidence                                                                                           | Judgment                                                                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C4-A ownership/lifecycle                | Added an overlay lifecycle registry used by PTY host-env assembly; added an explicit optional remote launch profile field; existing managed hook descriptor registry remains the legacy wire projection.                                           | `src/main/agent-hooks/overlay-registry.ts`, host-env assembly diff, remote installer type/tests.   | Partial: profile is validated and transported, but the SSH launch owner has not yet supplied a provider-specific profile at every launch site.                                                                           |
| C4-B OpenCode V2                        | Generated plugin now exports `id + setup` alongside the V1 `server`; normalizes V2 `data` envelopes and subscribes to available event streams while retaining the existing lifecycle handler.                                                      | Executed module contract test drives a V2 data-envelope event; OpenCode source digest updated.     | Partial: current public V2 plugin context does not expose an event domain, so event delivery is intentionally no-op on runtimes without `ctx.event`; this is reported as unsupported rather than represented by a label. |
| C4-B Auggie                             | Added the documented `auggie` source, `/hook/aug` route, settings events (`SessionStart`, `SessionEnd`, `PromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`), bounded POSIX launcher, remote installer, dedicated normalizer, and vendor registry. | `src/main/auggie/*`, provider routing tests, launcher contract tests.                              | Partial: local/remote adapter is real, but startup CLI-presence reconciliation is not yet joined to the legacy telemetry enum.                                                                                           |
| C4-C bounded transport/fish/argv        | Auggie uses bounded JSON stdin capture and URL-encoded payload stdin; POSIX and Windows command wrappers use guarded curl delivery; path quoting is covered for spaces/quotes; existing Hermes/OMP behavior is untouched.                          | `src/main/auggie/hook-service.test.ts`; focused shell/listener suites.                             | Pass for the new launcher contract; a real fish process run remains coordinator QA.                                                                                                                                      |
| C4-D Claude account hot-switch          | Added `selectAccountWithTransition`, returning explicit `succeeded` or `rolled_back` results around the existing serialized, rollback-safe selection path.                                                                                         | `ClaudeAccountSelection` and service API; existing account-selection rollback suite remains green. | Partial: no live auth/account mutation was attempted; a pending UI state and structured IPC exposure still belong to the owner seam.                                                                                     |
| Durable delivery/loader/artifact health | Added bounded, TTL-expiring, atomic host-local health records with artifact digest/length, loader, and delivery dimensions; OpenCode and Auggie materializers record artifacts.                                                                    | `integration-health.ts` unit tests; production calls in both materializers.                        | Partial: health recording is integrated, but relay receipt/loader callbacks do not yet update delivery/loader outcomes end-to-end.                                                                                       |

## Functional correctness

The focused implementation paths are type-safe and regression-tested. OpenCode V1 behavior, V2 setup loading, Auggie event normalization/config mutation, source routing, remote profile validation, Claude rollback behavior, and overlay assembly all pass their focused tests. No claim is made for unexecuted Electron, Windows-native, or live-auth flows.

## Architectural fit

The changes reuse the existing hook envelope, bounded stdin contract, installer utilities, provider dispatch, overlay services, serialized Claude selection, and PTY assembly. No status store, reducer, or reader-side precedence rule was introduced; integration health is diagnostics only and has TTL/record bounds. The vendor registry is intentionally separate from the legacy telemetry enum until a negotiated wire/schema change can be owned by the protocol lane.

## Concrete private precedent locations

Mechanism comparison and verified/unverified claims are recorded only in the untracked `C4_PRIVATE_PRECEDENT.md`; it is intentionally excluded from the commit and public artifacts.

## Public-safe deviations and remaining gaps

- OpenCode V2's currently published context has no public event subscription surface; the adapter loads and subscribes only when a runtime provides the capability, otherwise preserving V1 and honestly producing no V2 status events.
- Auggie is not added to the legacy `AgentHookTarget` telemetry enum, so automatic startup/remote allowlist detection does not yet install it without an owner-approved wire/schema extension.
- Remote `profile` is an optional, validated field; no mutable global profile is read after launch, but all provider launch callers still need to thread their selected profile.
- Loader and delivery health records currently begin as `unknown`/`unobserved`; relay receipt and plugin loader callbacks remain coordinator-owned seams.

## Validation

- `pnpm tc:node` — passed.
- `pnpm run check:code-quality:changed` — passed with zero findings.
- Focused Vitest suites for Auggie, integration health, OpenCode, provider listener routing, Claude account selection, and PTY host-env — passed (34 files, 375 tests).
- Electron/mobile/manual fish and Windows native validation — not run by instruction.

## Completion judgment

This C4 implementation is **incomplete** against the full requested batch. The safe outcome for this dispatch is failed/needs owner seams, not succeeded-with-gaps.
