# #10859: restart growth, current bound, and draft counterexample

Full issue body and ten comments were reviewed, including the explicit withdrawal of cross-machine amplification and both draft-losing pruning proposals. No affected-host attribution is possible from this proof.

## Actual source controls

The fixture uses the actual full Zustand test store, `buildWorkspaceSessionPayload`, `hydrateTabsSession`, `hydrateEditorSession`, and `applyWebSessionTabsSnapshot`. Persistence is JSON round-tripped. One valid host `file` tab at a fixed fixture path is repeatedly ingested. Restarts create a fresh store and execute both hydration actions. Drafts use the real `setEditorDraft` and `markFileDirty` actions. Eight cycles and small literal drafts bound the work. There is no native filesystem read, SSH, paired peer, Electron window, or network service.

| Control                                                      | Current code / named main                                                   | Reported hydration projection                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------- |
| Same snapshot without restart, 8 cycles                      | 1 row every cycle                                                           | 1 row every cycle                                 |
| Persist/hydrate/ingest, 8 cycles                             | 1,2,2,2,2,2,2,2                                                             | 1,2,3,4,5,6,7,8                                   |
| Existing original dirty draft, then restart and clean mirror | Draft preserved under older owned id; new visible tab targets clean bare id | Same                                              |
| Edit new visible duplicate, persist and hydrate              | Older clean first row wins; later dirty row skipped; draft lost             | Both duplicate rows restore; later draft retained |
| Existing local same-path owner plus remote mirror            | 2,3,3,3,3,3,3,3; local owner survives                                       | 2,3,4,5,6,7,8,9; local owner survives             |

All five tests pass for each variant on Node 26.6.0 and Electron 43.7.0 / Node 24.21.0 (20 executed cases, including the two-variant canonical-CRLF loader control). JSON reports are adjacent. These are model-level persistence lifecycle tests, not heap/RSS measurements or rendered editor checks.

## Historical and current fences

`source-versions.json` records 19 selected production/test/caller files; every current file is byte-identical to named main `291b4ddd6f1c1af480169885e0fda7f9c78ff053`. This is not a fence of every transitive import.

Reported version `v1.4.158` resolves to `141e5b6ca32001a8d2dc313def1276e37196b9cf`. The historical control projects its unmodified `hydrateEditorSession` method body (original lines 4465–4633) into the current lifecycle. Imports come from the later modular extraction, using the extraction's hydration helpers. Seven helper function bodies match the reported version exactly after removal of the `export` prefix; all four current primitive identity helpers also match exactly. `reported-projection.json` records named refs, hashes, and individual parity evidence. Historical TypeScript source fixtures are stored as text and overlaid at their production module identities; the original method fixture must be an exact substring of the projected module. No historical method logic is changed. The loader hashes every selected current source and historical fixture before either variant runs and normalizes LF/CRLF. The rest of the store, persistence, and mirroring pipeline is current. This is explicitly not a historical whole-application replay.

The `usedOpenFileIds` hydration guard first appears in merged PR #14850, commit `470ef65bd793396fe94efecd7f82edecabdbec8e`; its parent is `6cf6a7faffd381d6f0d3db9f36b9e14027810f0a`. Later merged PR #17370 (`16e6b103d6e2823a1a86644a625985f9e837d668`) adds explicit owner deduplication. The earlier guard already prevents this constant-tuple linear restart growth. Current hydration skips the second duplicate before inspecting its dirty draft, which explains the new draft counterexample.

## Interpretation and unresolved scope

This reproduces the issue's corrected historical per-restart mechanism in a bounded source projection. Current code does not exhibit linear growth under the same constant-input control; do not claim a present unbounded memory leak from these results. Dirty draft preservation remains a concrete correctness problem. Arbitrary row pruning, persisting a mirror marker, or path-only culling is not proposed: the tests demonstrate why full draft ownership must be reconciled first. Sleeping-session replay, changing worktree identifiers, varying input tabs, and routing errors are separate issue variants not executed here. No product changes were made. The current draft-loss assertion records a defect; a passing diagnostic test means the observed behavior matches the report, not that dirty drafts are safe.

## Reproduce

```sh
ORCA_BACKGROUND_LAUNCH=1 ORCA_10859_VARIANT=current pnpm exec vitest run --config docs/audits/mirrored-editor-restart-growth/vitest.config.mjs
ORCA_BACKGROUND_LAUNCH=1 ORCA_10859_VARIANT=reported-hydration pnpm exec vitest run --config docs/audits/mirrored-editor-restart-growth/vitest.config.mjs
```

For Electron, invoke the installed Electron binary with `ELECTRON_RUN_AS_NODE=1` and `ORCA_BACKGROUND_LAUNCH=1`, passing `node_modules/vitest/vitest.mjs` and the same arguments. Reports are separate by variant and runtime. Set `ORCA_EDITOR_RESTART_OUTPUT` to an alternate report path to preserve recorded outputs.

## Input correction and exclusions

All ten cached comments were read. The original cross-machine amplification claim and two proposed pruning fixes were withdrawn by their author after controls exposed restart-local growth and dirty-draft loss. The proof follows those corrections. It does not execute remote routing errors, sleeping-session replay, changing worktree identifiers, source-file reads, Monaco models, or varying host tab inputs. The model does not quantify the reported multi-gigabyte heap. Current source deduplication explains the bounded constant-input result; it does not close every symptom in the issue.
