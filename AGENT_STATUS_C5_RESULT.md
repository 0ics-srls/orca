# C5 implementation result

## Completed cases

- Added the canonical execution binding contract in `src/shared/agent-status-run.ts`.
- Extended `ClaimedAgentPtyOwnerRegistry.ensure` to mint one `runId` and opaque `attachment.executionId` atomically with each committed owner. Adoption returns the same binding; confirmed replacement mints a new pair and records `continuityOf`.
- Required and validated `AgentSessionOwnerBinding.statusBinding`; lower execution-host owners remain authoritative during relay/daemon adoption and snapshot reconciliation.
- Propagated the binding through `PtySpawnResult.agentSessionEnsure.owner.statusBinding` and retained it across local, daemon, relay, SSH and IPC ownership paths.
- Preserved legacy attribution labels for persisted compatibility while new canonical bindings use explicit execution-attachment/provider-alias/unresolved attribution names.
- Added regression coverage for concurrent ensure/adopt, replacement, malformed/conflicting lower owners, relay/SSH propagation, protocol gating, process-list accounting, and replay of a fresh `agentSessionCreateOperationId`.

## Shared dependency contract

Host observation consumes `AgentStatusExecutionBinding` from `owner.statusBinding`:

```ts
type AgentStatusExecutionBinding = {
  runId: string
  attachment: { executionId: string }
  role: 'root' | 'child'
  continuityOf?: string
}
```

`executionId` is the opaque exact attachment identity. PID, start time and ancestry stay host-private. The lifecycle seam is the committed/adopted owner result from `ClaimedAgentPtyOwnerRegistry.ensure` (`src/shared/claimed-agent-pty-owner.ts`), exposed by `PtySpawnResult.agentSessionEnsure` (`src/main/providers/pty-spawn-result.ts`). There is no separate C5 callback.

A bare `{ id, incarnationId }` replay for `agentSessionCreateOperationId` is launch deduplication evidence only. It intentionally has no `statusBinding`; C10 must not publish a pane-only seed and must wait for a committed or adopted `AgentSessionOwnerBinding`.

## Judgments

- **Architecture fit:** The binding is minted in the existing atomic owner reservation/adoption lifecycle; no parallel launch or resume registry was added. Attachment identity is separate from run identity, surface location and provider aliases.
- **Functional correctness:** Owner and wire-path regressions pass, including adoption preserving identity, replacement continuity, lower-owner authority and fresh-create replay without `agentSessionEnsure`.
- **Precedent/deviations:** The implementation follows the repository's execution-host ownership boundary and durable-owner lifecycle. Full subject-keyed status-store migration, hook emitter proof, provider alias reconciliation and reader cutover remain outside this foundation and require their assigned batches.
- **Validation:** `pnpm tc:node`; changed-file quality checks; `git diff --check`; direct changed-file lint; focused C5 suite (3 files, 52 tests) passed. The broader focused run used during implementation passed 17 files/271 tests.

## Remaining gaps / required sibling commits

- C10 must consume `owner.statusBinding` for committed/adopted membership and keep fresh create-operation acknowledgements pane/status-free.
- C6 must observe the exact attachment by `attachment.executionId`; it must not infer identity from PID, title, cwd or pane.
- C1/C2 own turn/outcome reduction and recovery; C7 owns host composition and replica publication. C5 does not provide a second lifecycle reducer or status journal.
- Remaining C5 plan cases (hook ingress emitter proof, subject-keyed store/readers, provider alias reconciliation and manual/nested attribution) still need their dedicated implementation slices.

## Commit

- `22f80ab284` — `feat(agent-status): bind runs to claimed execution owners`
