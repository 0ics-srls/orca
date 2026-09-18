# Memory PR merge handoff — 2026-09-17

Updated 2026-09-18T03:37:27.946541+00:00.

## Result: 31 merged, 26 remain open

User-authorized filter: low observed risk, strictly fewer than **100 changed production lines**, and no identified negative user-facing tradeoff. All merges use squash with the reviewed head SHA; no protection bypass or branch deletion.

Production LoC means additions plus deletions, excluding tests, verified test-only fixtures, documentation and audit evidence. Runtime/build configuration, build/CI tooling, dependency source/generated patches and lockfiles count. Generated patch text is counted as lines, not expanded into de-minified code.

The repository’s automated “Prod” column counts all non-test paths, including audit documentation. The counts here instead describe production changes; both totals are retained in the evidence.

## Merged PRs

| PR                                                                                                                        | Production LoC | Squash commit                              |
| ------------------------------------------------------------------------------------------------------------------------- | -------------: | ------------------------------------------ |
| [#20905](https://github.com/stablyai/orca/pull/20905) fix(renderer): cancel signout auth retry on unmount                 |              9 | `d3032da299b493abcc1d9eaff5020a90f750d65f` |
| [#20906](https://github.com/stablyai/orca/pull/20906) fix(renderer): cancel copied prompt reset on unmount                |             20 | `d7d3bcfc6653592be78ef5c6ea3298153eea4209` |
| [#20924](https://github.com/stablyai/orca/pull/20924) fix(renderer): release parked terminal scroll intents               |             17 | `bd404185f19d077065f926c06574c039a7986392` |
| [#20946](https://github.com/stablyai/orca/pull/20946) fix(relay): bound cyclic process-table traversal                    |              6 | `df88f83c707487add7715ed00ee0b754d6c76796` |
| [#20980](https://github.com/stablyai/orca/pull/20980) Release completed scanner cancellation IDs                          |              3 | `e9c04fb8d95254f0cb29addf669d4a597f8ca9a7` |
| [#21010](https://github.com/stablyai/orca/pull/21010) fix(browser): release page callbacks when a guest is destroyed      |             61 | `bdad0e0f00325e6242fb6240d6aaa3120d2bbaa0` |
| [#21131](https://github.com/stablyai/orca/pull/21131) fix: release completed runtime RPC queue payloads                   |              9 | `0e3acf577d7285057e039d99d2891799dbdc3fbb` |
| [#21135](https://github.com/stablyai/orca/pull/21135) fix: release aborted auth filesystem waiters                        |             48 | `f90370fb6b072847f625b4e1291a4927fe3c5ec4` |
| [#21136](https://github.com/stablyai/orca/pull/21136) fix: retire stale GitLab host cache generations                     |             44 | `51f809aa82b58343a38cdba1920190bfd01da3a0` |
| [#21138](https://github.com/stablyai/orca/pull/21138) fix: release Codex prompt claims after turn completion              |              2 | `fbfe3a2e74043673ccc928554f6fd667493cbb4a` |
| [#21139](https://github.com/stablyai/orca/pull/21139) fix: release completed terminal spawn inputs                        |             53 | `79800e60b4ba886da28bd65eaf9edbd264f570c7` |
| [#21140](https://github.com/stablyai/orca/pull/21140) fix: release native PTY spawn environment after setup               |              3 | `b899b225456f0744fadb02e4129a977b1e0361bc` |
| [#21142](https://github.com/stablyai/orca/pull/21142) Skip empty chunks in streamed agent text                            |              4 | `3c138bd8632f0d2fc72af0d0e50bd8cb4bd98a8b` |
| [#21144](https://github.com/stablyai/orca/pull/21144) fix: release canceled working-directory waiter references           |             62 | `ab331253a0a8df91d66a4d2d68955ec74db90ec8` |
| [#21150](https://github.com/stablyai/orca/pull/21150) fix: release completed SSH writer queue entries                     |             12 | `14654d03cb14abbcb6d442b360c403c2cc778bcd` |
| [#21160](https://github.com/stablyai/orca/pull/21160) fix: fence viewport state after browser guest retirement            |             11 | `1d09d557878856885b3654e96b8cbb8e570f1572` |
| [#21162](https://github.com/stablyai/orca/pull/21162) fix: release retired daemon owner incarnation metadata              |              6 | `98998b18ad2fe89f1a07dfe76788d73c96ec93f5` |
| [#21164](https://github.com/stablyai/orca/pull/21164) fix: release completed browser results after host close             |              9 | `78289d8ebe5584508750617caed011f0eacd16c6` |
| [#20996](https://github.com/stablyai/orca/pull/20996) fix(runtime): fence terminal snapshot completion by owner           |             48 | `9ed2f743a4dd7aab1d35906c049c11d143a92aaf` |
| [#20910](https://github.com/stablyai/orca/pull/20910) fix(main): release hang watchdog quit listener on shutdown          |              4 | `54500a4281f97e434940dc4a27ce5352b6796641` |
| [#20986](https://github.com/stablyai/orca/pull/20986) fix(ai-vault): release retired search write fences                  |             69 | `a0371806303c78755ede4461510098eabde0490b` |
| [#21012](https://github.com/stablyai/orca/pull/21012) fix(browser): fence late registration replies to their guest owner  |             46 | `54e11473a6d5ca53e7b6e1eabdcf99e28af5c1f9` |
| [#21000](https://github.com/stablyai/orca/pull/21000) fix(pty): reconcile daemon exits after synthetic notifications      |             75 | `41059f65b25d9ea1f67a3ed92ca795d98450a667` |
| [#21002](https://github.com/stablyai/orca/pull/21002) fix(sessions): stop transcript catch-up after TUI owner close       |              1 | `c09e8fe59a19521da861c72fb98698d269c6b2e3` |
| [#21018](https://github.com/stablyai/orca/pull/21018) fix(runtime): terminate nonblank tail scan at the first row         |              3 | `0e935c4b0ac132b77050fa918d0598fd78f51161` |
| [#21011](https://github.com/stablyai/orca/pull/21011) fix(runtime): preserve exited PTY authority across queued graphs    |             97 | `5723c5baa9a4292d2b9ea86ea38ec6ffc91e38a1` |
| [#21022](https://github.com/stablyai/orca/pull/21022) fix(projects): release processed repository scan records            |             10 | `f0dfc5de7b8c00c833c36eb83edfedfe95dbaeea` |
| [#20978](https://github.com/stablyai/orca/pull/20978) Release provider children after structured session holds disappear  |             49 | `c3c051dfa62860e0eec6dfc37b81106eba394125` |
| [#21019](https://github.com/stablyai/orca/pull/21019) fix(runtime): preserve observed exit during explicit terminal close |             85 | `1aadf9115346b28aa9acee93430e1fd47703b303` |
| [#20960](https://github.com/stablyai/orca/pull/20960) Detach retained CI and terminal tails from oversized strings        |             72 | `d04b05b5c8f0b8074a7e316c8cd6ccdbbddf7e2c` |
| [#20941](https://github.com/stablyai/orca/pull/20941) fix(stats): bound retained events during stalled writes             |              4 | `28c32f358736b6b01d28f0277203eef7e79f0b69` |

The landed production changes total **792 added/deleted lines**. Every squash commit is in the final named main, and every production addition/deletion matches its reviewed patch.

The table conservatively counts #21011 as 97 lines and #21019 as 85 because their displayed ancestry includes the already merged 75-line parent. Their actual new production changes are **22** and **10** lines, verified against fresh main before each merge. Both counts satisfy the threshold.

## Validation and integration

- The first 18 PRs had successful checks at their unchanged reviewed heads before merging.
- Nine main-based candidates were refreshed with non-force main merges to remove an inherited unused-import typecheck failure. Their production patch IDs and changed-line counts stayed identical.
- #20960 required preserving two adjacent imports. Its 72-line production change passed 204 tests across 21 suites; 239 loaded source hashes matched the candidate.
- #20978 required removing an obsolete test import while keeping its new registry import. Its 49-line production change passed 40 tests across three suites; 3,144 loaded source hashes matched the candidate.
- Current-head PR Checks `verify` covers the repository’s gating analysis, types, selected tests and packaging jobs. E2E/native companion jobs intentionally omitted from that aggregate are reported separately when relevant.
- #20941's first fresh shard passed all 10,321 tests but failed on an unhandled timer from an unchanged renderer test fixture. The failed shard and summary job were rerun once; both passed on the same head before merging. The original log and source-provenance diagnosis are retained.
- Local candidate execution used background launch on macOS. These focused tests do not substitute for native execution on every supported OS.

## Non-blocking checks at handoff

Snapshot: 2026-09-18T03:36:19.915498+00:00. The PR Checks `verify` aggregate passed for every merged head. The repository deliberately excludes E2E from that aggregate; the following companion jobs were still running at this snapshot:

| PR                                                    | Companion check                                                                                                  | Status      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------- |
| [#20960](https://github.com/stablyai/orca/pull/20960) | [e2e / ssh docker watcher isolation](https://github.com/stablyai/orca/actions/runs/35302520492/job/105469641960) | IN_PROGRESS |
| [#20960](https://github.com/stablyai/orca/pull/20960) | [e2e / changed e2e specs](https://github.com/stablyai/orca/actions/runs/35302520492/job/105469641933)            | IN_PROGRESS |
| [#21000](https://github.com/stablyai/orca/pull/21000) | [e2e / ssh docker watcher isolation](https://github.com/stablyai/orca/actions/runs/35302231280/job/105468023617) | IN_PROGRESS |

These pending jobs are not represented as passes. The merge used the repository’s successful aggregate plus the reviewed source and targeted validation.

## PRs outside the merge criteria

These **26 PRs remain excluded** by the requested size or user-impact filter. Changed production LoC means **added + deleted lines**, excluding tests and audit/docs evidence; runtime/build configuration, dependency patches and generated patch text are counted. Counts use each PR's current base, including its stack parent. Low code risk does not mean zero regression risk.

### Size or dependency only — 9 PRs

No negative user-facing tradeoff was identified in the reviewed final change for these rows; each exceeds the strict **<100 LoC** limit.

| PR                                                                                      | Prod LoC | Risk                            | Why left / dependencies                                                                                                    |
| --------------------------------------------------------------------------------------- | -------: | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [#20908](https://github.com/stablyai/orca/pull/20908) HMR listener cleanup              |      122 | Low                             | Size. Preserves pending Clear/Undo flushes while retiring old listeners.                                                   |
| [#20909](https://github.com/stablyai/orca/pull/20909) Renderer/preload cleanup          |      111 | Low                             | Size. Dead-renderer requests reject promptly; live requests retain their behavior.                                         |
| [#21001](https://github.com/stablyai/orca/pull/21001) Close pending local/SSH panes     |      240 | Low after correction            | Size. Retires explicitly closed pending PTYs with restored confirmation and ownership checks.                              |
| [#21005](https://github.com/stablyai/orca/pull/21005) Close pending remote panes        |      200 | Low after correction            | Size; requires **#21001**. Scoped handles retain the same confirmation safeguards.                                         |
| [#21006](https://github.com/stablyai/orca/pull/21006) Cancel work during host teardown  |      131 | Low                             | Size. Retired-host acquisition stops; an interrupted operation can report stopped.                                         |
| [#21009](https://github.com/stablyai/orca/pull/21009) Retire renderer log watches       |      156 | Low                             | Size. Dead renderers cannot admit late watchers or disturb successors.                                                     |
| [#21112](https://github.com/stablyai/orca/pull/21112) Fix terminal reflow retention     |      197 | Low code risk; stack dependency | Size; requires **#20981 → #20992**, which remain held for cache/CPU costs. Live terminal history capacity stays unchanged. |
| [#21113](https://github.com/stablyai/orca/pull/21113) Persist never-started tab closes  |      363 | Low                             | Size. Explicitly closed empty tabs stay closed after later saves.                                                          |
| [#21167](https://github.com/stablyai/orca/pull/21167) Release unrelated SSH file frames |      120 | Low                             | Size. Preserves supported peers' metadata-before-content ordering; no content/history quota changes.                       |

### Behavior, performance or remaining implementation review — 17 PRs

| PR                                                                                        | Prod LoC | Risk / reason held                    | Concrete tradeoff                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | -------: | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#20947](https://github.com/stablyai/orca/pull/20947) Terminal stream backpressure        |      568 | Behavior + size                       | A connected viewer that never drains can block the output-producing process indefinitely.                                                               |
| [#20949](https://github.com/stablyai/orca/pull/20949) Bound CDP output                    |       39 | Behavior                              | Disconnects automation clients at 64 MiB or 4096 queued frames; outstanding commands/events can be lost.                                                |
| [#20955](https://github.com/stablyai/orca/pull/20955) Retire stale terminal hyperlinks    |      136 | Performance/private API + size        | Periodic full-buffer scans add synchronous work; measured sweep was about 10 ms for 5,024 × 160 cells. Uses guarded private xterm state.                |
| [#20963](https://github.com/stablyai/orca/pull/20963) Bound AI Vault records              |       21 | Behavior                              | A new 10 MiB local-record cap omits affected sessions from scans; later appends cannot bypass the rejected record.                                      |
| [#20965](https://github.com/stablyai/orca/pull/20965) Bound empty-glyph cache             |      216 | Performance + size                    | Evicts derived results above 4096 entries; live text stays, but cache churn adds rasterization work.                                                    |
| [#20976](https://github.com/stablyai/orca/pull/20976) Enforce legacy-import quota         |       17 | Low code risk; strict UX exclusion    | A file growing beyond the existing 16 MiB allowance can now fail import instead of restoring successfully.                                              |
| [#20981](https://github.com/stablyai/orca/pull/20981) Bound contrast caches               |      454 | Performance/engine integration + size | A 4096-entry cache cap preserves colors/history but adds recomputation under cache churn. Parent of **#20992**.                                         |
| [#20992](https://github.com/stablyai/orca/pull/20992) Release erased terminal strings     |     1066 | Measured performance cost + size      | Synthetic ASCII parsing measured about **5% slower**; live text stays. Requires **#20981**.                                                             |
| [#21014](https://github.com/stablyai/orca/pull/21014) Refuse stale terminal inventory     |       27 | Low code risk; strict UX exclusion    | Lifecycle races can return unavailable inventory and require retry.                                                                                     |
| [#21020](https://github.com/stablyai/orca/pull/21020) Persist acknowledged tab retirement |      151 | Low code risk; UX + size              | A close racing an identity change can be refused as stale, requiring another close attempt.                                                             |
| [#21021](https://github.com/stablyai/orca/pull/21021) Enforce history-read quota          |       11 | Low code risk; strict UX exclusion    | A file growing beyond the existing 16 MiB limit can leave history reconciliation inconsistent/unverifiable.                                             |
| [#21024](https://github.com/stablyai/orca/pull/21024) Stream ancestry proofs              |      217 | Low code risk; UX + size              | Concurrent appends outside the opened-file observation can require retry; no smaller content quota.                                                     |
| [#21128](https://github.com/stablyai/orca/pull/21128) Enforce crash-dump quota            |       16 | Low code risk; diagnostic tradeoff    | A dump growing beyond the existing 64 MiB allowance is skipped, potentially losing a diagnostic signature. Source file remains.                         |
| [#21129](https://github.com/stablyai/orca/pull/21129) Bound speech backlog                |      169 | Behavior + size                       | Stops dictation at an 8 MiB/1024-frame backlog; accepted but undelivered transcription can be lost.                                                     |
| [#21175](https://github.com/stablyai/orca/pull/21175) Retire unpaired-host state          |      147 | Low code risk; UX + size              | Unpairing drops the client session/UI mirror; restoring those caches on re-pair is not guaranteed. Requires **#21113**. Remote processes/journals stay. |
| [#21178](https://github.com/stablyai/orca/pull/21178) Retire closed editor models         |      398 | Behavior + size                       | Reopening the last/hidden closed editor no longer preserves its accidentally retained undo/view caches.                                                 |
| [#21185](https://github.com/stablyai/orca/pull/21185) Retire uninstalled-plugin logs      |      198 | Behavior + size                       | Successful uninstall clears that installation's **200-row log history**; reinstall starts fresh. Failed uninstall retains it.                           |

The two previously withdrawn PRs, **#20903 and #20904**, are closed and are not part of these 26 open exclusions.

## Scope and evidence

- This is the disposition of the 59 memory-audit PRs. The previously withdrawn #20903 and #20904 remain closed.
- No affected-host data became available for #19831. These fixes do not establish which mechanism caused that incident.
- [Prior complete risk review](memory-pr-risk-review-2026-09-17.md).
- [Evidence index](memory-pr-merge-handoff-2026-09-17/index.json): exact-head counts, merge responses, CI snapshots, source landing verification and conflict validation.
- [Original CI flake diagnosis](memory-pr-merge-handoff-2026-09-17/20941-shard5-diagnosis.md).
