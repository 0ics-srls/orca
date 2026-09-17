# Memory PR handoff: merge order and CI evidence

Independent review of `docs/audits/memory-pr-validation-2026-09-16.json` and `/tmp/orca-memory-pr-status-current.json`. **Snapshot: 2026-09-17 06:43:48.892198 UTC; 57 open PRs: 30 SUCCESS, 25 FAILURE, 2 PENDING.** All cached check connections report complete pagination. These are head-rollup observations, not merge approvals or a claim that all CI is green. Root will add the final Monaco/plugin PRs and refresh their statuses separately. No GitHub requests, product edits, reruns, or new discovery were performed for this handoff.

## Required merge order

| Family | Order | Reviewer note |
| --- | --- | --- |
| Terminal engine | [#20981](https://github.com/stablyai/orca/pull/20981) → [#20992](https://github.com/stablyai/orca/pull/20992) → [#21112](https://github.com/stablyai/orca/pull/21112) | Contrast → erased-cell strings → reflow rows. Child PRs target the preceding topic branch. |
| Pending pane close | [#21001](https://github.com/stablyai/orca/pull/21001) → [#21005](https://github.com/stablyai/orca/pull/21005) | IPC pending-close fixture/behavior underlies scoped remote pending-close. |
| Physical PTY exit | [#21000](https://github.com/stablyai/orca/pull/21000) → [#21011](https://github.com/stablyai/orca/pull/21011) and [#21019](https://github.com/stablyai/orca/pull/21019) | Queued-graph and observed-exit fixes are siblings, each based on physical-exit reconciliation. Neither sibling is the other's prerequisite. |

The other **52 cached PRs target main**, including [#21175](https://github.com/stablyai/orca/pull/21175). No additional hard dependency is established by this review. After each parent merge, retain the child patch while retargeting/rebasing and rerun relevant checks on the resulting head.

Coordinate overlapping xterm patches/generated desktop, headless and mobile engines (#20955/#20965 and the terminal stack). Regenerate the combined mobile payload and its exact hash/length guard; do not copy another branch's expected hash. The ledger records branch-specific verification. For overlapping PTY graph/inventory work, retain both ownership guards and rerun the combined control documented in `localCombinedGraphInventoryProof`; that local result is not merge-tree CI.

## Current red checks: classify the leaf failure

**Inherited main regression:** all 25 cached failed PRs have static/typecheck failures matching the unused `NativeChatMessage` import in `NativeChatMessageList.windowing.test.tsx:12`. The ledger identifies main commit `15cac68802361f3b9075630335d3e6d379c2a909` / blob `e95f6cfb4061b1e1faabe77220c65bc4466ffb0d`, following #20898. Twenty-three PRs have matching current-job annotations in the ledger; #20941/#20986 are additionally confirmed by cached `*-static-new.log` and `*-tc-new.log` files, with current job URLs matching `/tmp/orca-memory-new-failures-result.json`. Example [static failure](https://github.com/stablyai/orca/actions/runs/35070237926/job/104709930441) and [typecheck failure](https://github.com/stablyai/orca/actions/runs/35070233999/job/104709915345).

This proves the source of those static/typecheck failures, not the source of every failing test. Confirm the shared main regression is corrected before expecting a rebase/rerun to pass. A refresh to a main revision that still contains the import does not fix it. `verify` is an aggregate failure when its prerequisite jobs fail; it is not a separate retaining-path diagnosis.

| Additional failed test | Established evidence | Classification / remaining action |
| --- | --- | --- |
| [#20906 watcher shard](https://github.com/stablyai/orca/actions/runs/35070398651/job/104710545230) | Untouched `transcript-watch.test.ts` times out awaiting same-size replacement; later assertion finds one watcher. Cleanup occurs after the awaited condition, so that timeout can strand the fixture's watcher. PR changes only `EphemeralVmsPane.tsx`. | Failure and cleanup consequence explained; initiating timeout unproven. Keep distinct from the PR's copied-prompt timer fix. |
| [#20981 renderer shard](https://github.com/stablyai/orca/actions/runs/35070307981/job/104711654658) | All 1,090 test files passed; an asynchronous React callback raised `window is not defined` after teardown. Target component/fixture is untouched. | Unattributed async teardown failure; unchanged file alone does not prove complete independence. |
| [#21022 watcher shard](https://github.com/stablyai/orca/actions/runs/35084978035/job/104757701211) | Same-size prefix rewrite observed two callbacks instead of one. Test blob matches named main. | Cause unresolved; no claim that this is a proved flake. |
| [#21022 performance shard](https://github.com/stablyai/orca/actions/runs/35084978035/job/104757701210) | Cold browser-history corpus measured 2.711498 ms versus 2 ms; test blob matches named main. | Threshold miss established, timing cause unresolved. |
| [#21009 shard 5](https://github.com/stablyai/orca/actions/runs/35077649975/job/104733891264), [#21010 shard 5](https://github.com/stablyai/orca/actions/runs/35077651745/job/104733965979) | The initial review lacked these logs; the final handoff addendum below records both exact diagnostics. | **Superseded below:** React scheduler `window is not defined` after passing tests; originating callback remains unproven. |

## Introduced failures that received corrections

These were genuine patch/test/artifact defects, not baseline excuses:

- #20941/#20986/#20992: forbidden `Reflect.get` test access; replaced with the recorded typed/documented alternatives.
- #20955/#20981/#20992: stale branch-specific generated mobile payload expectations; regenerated and checked per branch.
- #20978/#20992: proof-script `new Function` rejected by React Doctor; replaced with isolated CommonJS loading.
- #21024: transcript-close test confused a reused descriptor number with the original file handle; now checks the original handle's closure.
- #21112: obsolete negative-buffer-property assertion and stale mobile hash; expectations now match corrected retained rows and each branch's engine.
- #21113: new optional bridge read `window` in windowless store tests; now preserves the existing close without requesting that bridge.
- #21142: durable proof's unbraced `if`; corrected and all executable artifact files included in local quality checks.
- #21167: old provider fixture omitted the synchronous `beforeResolve` metadata callback; moved the empty-file control into the actual streaming mux fixture. Corrected head **17b57bfbc486449fbb4cad453ce2fc6e96c4a8ee** has 124 focused local tests passing. No product change in that correction.

The cached heads of #20992/#21024/#21112/#21113/#21142 are SUCCESS. Several earlier corrected PRs remain red on the shared main regression; local correction validation does not make their remote checks green.

## Rerun-only observations and pending heads

- #21131: untouched cold-cache `resolve-7za-path.test.mjs` returned status 1; missing captured stderr leaves the cause unproven. Same-head failed-job rerun passed; cached head is SUCCESS. [Original job](https://github.com/stablyai/orca/actions/runs/35173437413/job/105050004011).
- #21138: untouched browser-history performance test measured 2.584757 ms versus 2 ms; same-head rerun passed. Cached head is SUCCESS; the timing cause remains unproven. [Original job](https://github.com/stablyai/orca/actions/runs/35175767178/job/105057094035).
- #21167: old head **458e11e9f3f5981a85fc1006083c19738a8b26e3** also had an untouched Windows PTY-job grandchild that never reported its PID (same main/topic blob `c5f408f73115a11821b06fafe04ca28eaa15acb7`). Cause unproven. At the snapshot, corrected-head Windows packaging and tests had passed; SSH Docker watcher isolation and `pullfrog` remained in progress. Overall **PENDING**, not the old head's FAILURE.
- #21175: head **ace839c0ffdd9659fdf65d19e0c74284658fbd7d**, base `main`, **PENDING** with queued/running analysis, typecheck, packaging and test jobs. Its local before/fixed proof and ownership review do not substitute for those checks.

Before merging, use the refreshed exact head and base, review outstanding leaf failures, and retain the stack ordering above. The final Monaco/plugin publications are outside this 57-head snapshot and must be added by the root handoff. Discovery is stopping; scanner quit custody and other unpromoted leads remain evidence-only follow-ups.

## Root follow-up: the two missing shard diagnostics

Root fetched the exact #21009 and #21010 shard-5 failed logs while preparing the final handoff. Both have one unhandled React scheduler `ReferenceError: window is not defined`, attributed by Vitest to `AiVaultSessionSubagents.test.tsx`. #21009 has 1,094 passing test files / 10,067 passing tests; #21010 has 1,092 passing files / 9,985 passing tests. The test cases pass, but the unhandled exception fails the job. The diagnostic class is now identified; the originating asynchronous callback remains unproven. These leaves belong with the unattributed React teardown failure above, not a blanket inherited-import explanation. No product/test change or rerun was performed.

The final handoff links a newer exact-head status snapshot; this review's 57-PR snapshot remains historical.

## Current main correction verified

At 2026-09-17 07:01:31 UTC, root fetched the named test file from GitHub `main`. Blob `b843a6bdc5dd0b12d64809d21c7649160e0f3747` contains no exact `NativeChatMessage` type token; the unused import has been removed. The older failed checks still describe their tested merge trees. Refresh those PRs onto corrected main and rerun, preserving the stack order. This removes the identified static/typecheck cause, without proving the separate watcher, performance, or React failures will pass.
