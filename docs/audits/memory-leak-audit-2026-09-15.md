# Memory leak audit (2026-09-15)

The audit produced **38 separate PRs**: 34 target `main`; four are stacked to reuse existing fixes and fixtures. Terminal-cell cleanup builds on the contrast-cache PR, scoped remote pending-pane close builds on IPC pending-close, and queued-graph plus observed-exit fixes build on physical-exit reconciliation. The largest new
reproduced mechanisms are terminal hyperlink metadata retention, stalled daemon
output, stalled CDP delivery, oversized strings retained by small text tails,
unbounded transcript record assembly, invisible WebGL glyph caches, and contrast-color caches. They establish real defects in code paths that
can consume large amounts of memory; **they do not prove the cause of #19831 or
#19768**. Affected-host data is unavailable, and the issue map keeps that limit
explicit.

## Results

| Mechanism                                                          | Evidence and fix                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OSC 8 hyperlinks survive cell overwrite                            | A real 24-row terminal retains 10,000 historical link entries, about 20.5–20.9 MB after GC; collection reduces the same run to 1.6–1.7 MB. Covers headless mirrors/daemons, desktop panes/previews, and mobile. [#20955](https://github.com/stablyai/orca/pull/20955), [reproduction](./osc-link-retention/README.md).                                                                                                                                  |
| Daemon held-queue valve moves backlog into the socket              | A paused reader retains another 66.4 MB in the socket after 96 MiB of input while the held queue stays near 32 MiB. Producer backpressure and hidden-output shedding bound accumulation in the fixed reproduction. [#20947](https://github.com/stablyai/orca/pull/20947), [reproduction](./daemon-stream-retention/README.md).                                                                                                                          |
| CDP client stops reading                                           | The baseline retains 133,177,280 queued bytes after a 128 MiB burst. The fix bounds backlog with the existing outbound queue and terminates overflowing clients. [#20949](https://github.com/stablyai/orca/pull/20949), [reproduction](./cdp-stream-retention/README.md).                                                                                                                                                                               |
| Small CI/terminal tails and Claude labels retain oversized parents | Eight capped CI excerpts retained 16–32 MiB; eight error strings totaling 32,000 characters retained 32 MiB; terminal tails reporting 4 MiB retained 32 MiB. Copying at retention boundaries reduces them to about 0.1–0.15 MiB, 33 KiB, and 4 MiB. Eight 512-character Claude labels separately retain about 32 MiB before and 7–12 KB after. [#20960](https://github.com/stablyai/orca/pull/20960), [reproduction](./retained-text-slices/README.md). |
| Erased terminal cells retain old Unicode strings                   | Eight overwritten cells retain about 42.9 MiB in the real engine; releasing sparse-map, invalid-cache, and shared-scratch references reduces separate dead-text cases to about 0.1–0.2 MiB. Live Unicode remains intact. [#20992](https://github.com/stablyai/orca/pull/20992), [reproduction](./terminal-cell-retention/README.md).                                                                                                                    |
| AI Vault assembles an oversized transcript record                  | A 64 MiB record peaks near 248 MiB RSS despite the child’s 384 MiB old-space setting. Reusing the remote 10 MiB record cap stops at the cap plus one input chunk and peaks near 62 MiB. Failed scans preserve their previous resume point. [#20963](https://github.com/stablyai/orca/pull/20963), [reproduction](./transcript-record-retention/README.md).                                                                                              |
| Invisible WebGL variants bypass texture-page eviction              | 100,000 colored-space redraws keep 100,093 entries and about 13.6 MB heap growth on one texture page. A separate 4,096-entry cap leaves 1,789 entries and about 0.2–0.4 MB growth in the reproduction, preserving shared terminals’ pixels. [#20965](https://github.com/stablyai/orca/pull/20965), [reproduction](./webgl-empty-glyph-retention/README.md).                                                                                             |
| Contrast corrections retain every color pair                       | 100,000 redraws retain over 100,000 entries and 4–5.5 MB after periodic atlas clears. Desktop CJS/ESM and the mobile WebView engine now stay within 4,096 entries per normal/dim cache, preserving corrected colors and pixels. [#20981](https://github.com/stablyai/orca/pull/20981), [reproduction](./terminal-contrast-cache-retention/README.md).                                                                                                   |
| Legacy import outgrows its stat-time quota                         | A real source grows from 149 bytes to 17 MiB after the size check. Enforcing the existing 16 MiB quota during reading refuses the whole import and preserves the journal. [#20976](https://github.com/stablyai/orca/pull/20976), [reproduction](./legacy-import-source-budget/README.md).                                                                                                                                                               |
| Last session hold disappears during acquisition                    | A provider child arrives with no holder and no timer. Existing release grace now covers acquisition and failed replacement, with incarnation/registration checks protecting newer holders. [#20978](https://github.com/stablyai/orca/pull/20978), [reproduction](./structured-hold-retention/README.md).                                                                                                                                                |
| Completed scanner requests receive late cancellation               | 1,000 completed requests retain 1,000 numeric IDs before and zero after. This is small child-process metadata. [#20980](https://github.com/stablyai/orca/pull/20980), [reproduction](./scanner-late-cancel/README.md).                                                                                                                                                                                                                                  |
| Search indexing retains retired filenames                          | 1,000 index/delete cycles retain 1,000 removed paths before and zero after. Active-read fences still reject stale searchable content. This scanner-child writer was absent from v1.4.198. [#20986](https://github.com/stablyai/orca/pull/20986), [reproduction](./session-search-write-fences/README.md).                                                                                                                                               |
| Terminal snapshots finish after their owner retires                | Late callbacks recreate metadata or alter replacement state. Object/generation guards fix all 22 actual-runtime cases, versus 16 failures before. [#20996](https://github.com/stablyai/orca/pull/20996), [reproduction](./headless-hydration-retention/README.md).                                                                                                                                                                                      |
| Final daemon output arrives after synthetic exit                   | Actual independent control/stream sockets leave a dead PTY connected with headless/title state retained, even after fresh host inventory proves exit. Physical-exit reconciliation releases it; [#21000](https://github.com/stablyai/orca/pull/21000), [reproduction](./daemon-late-exit/README.md).                                                                                                                                                    |
| Restored split closes while its IPC connect is pending             | The saved binding disappears before the transport has an ID; late reattach/cold restore survives without a kill request. Capture close intent and recheck current owners at completion; [#21001](https://github.com/stablyai/orca/pull/21001), [reproduction](./pending-split-close/README.md).                                                                                                                                                         |
| Successful TUI close leaves transcript observation running         | A real filesystem watcher remains after the host session is removed and its lease released. Existing catch-up cleanup fixes four actual-host lifecycle cases; [#21002](https://github.com/stablyai/orca/pull/21002), [reproduction](./tui-transcript-close/README.md).                                                                                                                                                                                  |
| Scoped remote split closes during pane resolution                  | The saved remote handle outlives an explicitly closed viewer. Capturing its exact environment/handle and rechecking ownership after compatibility prevents omitted close requests; [#21005](https://github.com/stablyai/orca/pull/21005), [reproduction](./pending-runtime-pane-close/README.md).                                                                                                                                                       |
| TUI transcript acquisition crosses host teardown                   | Late resolver/subscription completion installs a watcher or launches after shutdown. Cancellation settles setup, releases late resources, and abandons unused reservations without replacement acquisition; [#21006](https://github.com/stablyai/orca/pull/21006), [reproduction](./tui-transcript-acquisition/README.md).                                                                                                                              |
| Log-tail watchers outlive their renderer                           | Authorization completes after destruction; installed watchers also survive process loss or document replacement. Twenty destroyed owners retain twenty real watchers before and zero after; [#21009](https://github.com/stablyai/orca/pull/21009), [reproduction](./local-log-tail-lifetime/README.md).                                                                                                                                                 |
| Destroyed browser guests retain page callbacks                     | A thousand destroyed guests leave a thousand entries in each of four callback maps; primary-owner unregister releases them while preserving replacements and popups. [#21010](https://github.com/stablyai/orca/pull/21010), [reproduction](./browser-destroyed-guest-retention/README.md). Native retained bytes were not measured.                                                                                                                     |
| Queued graphs restore exited terminal ownership                    | Actual publisher/Store/socket ordering restores a dead owner or conflicts with a successor. Existing exit certificates now fence reconnection while keeping sleeping-pane membership. [#21011](https://github.com/stablyai/orca/pull/21011), [reproduction](./queued-terminal-graph-exit/README.md).                                                                                                                                                    |
| Late browser registration restores closed-page metadata            | A thousand deferred replies restore a thousand closed-page guest IDs before and zero after owner checks. Replacement guests and hidden current guests have controls. [#21012](https://github.com/stablyai/orca/pull/21012), [reproduction](./browser-registration-reply-retention/README.md).                                                                                                                                                           |
| A delayed process list overwrites a newer PTY owner                | Stale positive and absent rows now fail the existing provider-generation check before changing handles or liveness. Twelve failing cases plus six controls become 18 passing tests. [#21014](https://github.com/stablyai/orca/pull/21014), [reproduction](./stale-pty-inventory/README.md).                                                                                                                                                             |
| Backward terminal-tail scan fails to advance at the first row      | Five isolated inputs time out before and terminate after a cursor-bound fix. Normal producers filter blanks; a complete application trigger remains unproven. This allocation-free loop does not explain the OOM incidents. [#21018](https://github.com/stablyai/orca/pull/21018), [reproduction](./terminal-wait-leading-blank/README.md).                                                                                                             |
| Aggregate stop verification overwrites an already observed exit    | Two actual daemon endpoints reproduce physical EXIT followed by unrelated inventory failure. Same-incarnation exit authority now prevents a redundant kill and second renderer exit. [#21019](https://github.com/stablyai/orca/pull/21019), [reproduction](./terminal-close-observed-exit/README.md).                                                                                                                                                   |
| Acknowledged terminal close leaves its persisted tab | A renderer acknowledgment can precede graph removal while Store rebasing preserves the omitted row. Exact identity checks now permit the existing host retirement transaction; 28 failing cases plus three controls become 31 passes. [#21020](https://github.com/stablyai/orca/pull/21020), [reproduction](./acknowledged-tab-retirement/README.md). |
| Claude history quota during concurrent source growth | A 305-byte checked file grows to 17 MiB before read. The existing 16 MiB quota now stops at one overflow-probe byte and preserves the inconsistent-history result. [#21021](https://github.com/stablyai/orca/pull/21021), [reproduction](./claude-history-window-budget/README.md). This reader is absent from v1.4.198. |
| Completed nested-repository scan records | At a controlled scan pause, 94 completed directory records and their ignore-rule arrays remain reachable before; none after consumed slots are released. Same 193-directory traversal; temporary retention, no measured byte magnitude. [#21022](https://github.com/stablyai/orca/pull/21022), [reproduction](./nested-repo-processed-queue/README.md). |
| Stats persistence stalls                                           | The live event array exceeded its serialize-time cap. It now retains the newest 10,000 events on append. [#20941](https://github.com/stablyai/orca/pull/20941).                                                                                                                                                                                                                                                                                         |
| Process-table ancestry cycle                                       | A two-row cycle exhausts an isolated 32 MiB heap in about 0.15 seconds. Existing [#20715](https://github.com/stablyai/orca/pull/20715) covers the shared walker; [#20946](https://github.com/stablyai/orca/pull/20946) fixes the independent relay walker.                                                                                                                                                                                              |
| Smaller lifecycle leaks                                            | Eight PRs cover editor/diff/auth/prompt timers, renderer HMR listeners, main IPC relay/preload cleanup, watchdog listeners, and parked scroll-intent records. These are not gigabyte explanations. [Full PR list](./memory-leak-scan-2026-09-15.md#pull-requests).                                                                                                                                                                                      |

Risks differ by change. Hyperlink collection uses tested private xterm fields and
scans both buffers after registry growth; its CPU cost scales with scrollback.
Daemon backpressure depends on producer pause support. CDP overflow disconnects
the stalled client. Evicted invisible WebGL variants need rasterization when
revisited, while visible glyphs and texture pages stay intact. String copying costs scale with the retained caps and does
not reduce temporary original-input allocations. The transcript cap turns a
legitimate record over 10 MiB into a per-session scan issue and covers the
resumable JSONL route, not every whole-document/import reader. The cell cleanup preserves live text but adds about 5% synthetic ASCII parsing time in the emitted-headless benchmark; this is not an application-wide performance estimate. The timer/listener changes have smaller behavioral scope.
An unsafe legacy-daemon shutdown proposal was closed and reverted after review
found a race that could kill live work; it is excluded from the fix count. The later [exact-owner proof](./daemon-stop-owner-authority/README.md) and [endpoint-guard proof](./daemon-shutdown-identity/README.md) demonstrate further replacement-session hazards, including a fallback that defeats the first refusal. Those candidates remain unpublished.

## Issue correlation

The [issue ledger](./memory-leak-scan-2026-09-15.md#github-memory-issue-correlation)
accounts for the memory/process-resource title matches and additional reports
from body searches. The [search index](./memory-issue-index-2026-09-15.json)
preserves 58 original title matches with explicit unrelated exclusions; a
batched recheck found 57 still open, no new matches, and #9141 closed. All six
searches returned a complete first page below the 100-result cap.

The ledger separates reproduced retaining paths, ownership/cleanup gaps,
intentional resource policies, historical fixes, and incidents without enough
attribution evidence. It also records existing PRs rather than duplicating them.
In particular, Linux/Windows Chromium descriptor inheritance remains covered by
[#16963](https://github.com/stablyai/orca/pull/16963); renderer string-slice cleanup
from #13040 already exists in the reported release. The main and daemon xterm
versions affected by the new hyperlink reproduction also shipped in `v1.4.198`,
as did the original nine string-retention boundaries and the Claude description slice added to that fix. The current task name/settled/removed owners are separately described in the [task proof](./claude-task-retention/README.md). #15241 now has a
reproduced error-surface retention defect even though logical caps already existed.

The [macOS tag investigation](./macos-allocation-tags/README.md) also prevents a false attribution shortcut in #19768. Exact Electron/Chromium/V8 sources show that ArrayBuffers can occupy both reported tags, depending on sandbox mapping and reuse. A bounded installed-Electron experiment confirms fresh typed arrays under tag 255 and reused ones under tag 253 while Node's `arrayBuffers` metric remains zero. This does not identify the incident's owner or reproduce its scale.

## Which process can grow

| Process                           | Reproduced mechanisms or relevant ownership                                                                                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron main / owning runtime    | Headless hyperlink registry, erased cell strings, CI/PTY/Claude backing strings, legacy import quota race, late-snapshot metadata, late-exit model recreation, closed-TUI transcript watchers, process-table traversal. Structured hold races retain a provider child and its host state. |
| Terminal daemon                   | Headless hyperlinks, erased cell strings, and stalled output; existing Linux/Windows descriptor-inheritance work is tracked in #16963.                                                                                                                                                    |
| Desktop renderer                  | Hyperlinks, erased cell strings, retained terminal tails, invisible WebGL variants, and contrast-color pairs.                                                                                                                                                                             |
| AI Vault scanner child by default | Oversized incremental records, whole-document allocation peaks, late-cancel metadata, and current-code retired search paths. An explicit service-process override uses a worker thread sharing main's PID.                                                                                |

This distinction matters for #19768's separately measured main PID. Renderer or
child-only findings cannot be assigned to it. #19831 reports an application scope,
which combines multiple possible owners without identifying the retaining process.
The new PTY detector evidence uses ordinary 64 Ki-character frames as well as larger
stress inputs; its costs follow owner count and latest input, not an unlimited
history of chunks. Shared parents make isolated detector measurements non-additive.

The ledger corrects earlier overstatements: #15210 says most accumulated
shells never received a kill request, and #19018's missing memory-diagnostic row is
not proof of process death. The new pending-split and delayed-exit proofs now explain concrete paths matching those symptoms. They do not establish the proportion of #15210's shells or #19018's later failed close. In #19768, `agent_start` counts live working-state transitions; 44 such entries do not establish 44 process spawns. A [portable recorder proof](./agent-start-count-semantics/README.md) and the reported-version code confirm that distinction.

#19768’s follow-up adds 17.95 GB within 190 seconds and identical main-thread hang samples. The audit now includes that evidence and the [watchdog’s actual contract](./hang-watchdog-semantics/README.md): a 45-second threshold and a marker reported on the next launch. Neither its quiet worker nor the stats count names the leaking function. A further [collection-mutation scan](./main-collection-loop-review/README.md) reviewed 14 direct same-Map update sites across 3,876 loops without finding a growing iteration; its alias and callback limits are explicit.

The [reconnect comparison](./relay-replay-overflow/README.md) reproduces a historical inline-replay capacity failure relevant to #11943. Existing #17968 already prevents that overflow from closing the connection. The precise reported publication and the watcher-to-EPIPE chain in #12931 remain unproven; neither is a demonstrated memory leak.

A separate [actual Store/runtime proof](./local-tab-close-rebase/README.md) reproduces #17344-style local tab resurrection: host membership rebasing restores an explicitly closed unbound row, and an acknowledgment can precede graph removal. The acknowledged whole-tab path is now fixed by [#21020](https://github.com/stablyai/orca/pull/21020), with replacement/pin/split-exit controls. Direct renderer-only never-bound closes remain a separate confirmed gap; no broad stale-save protection was removed.

## Coverage and reproducibility

The scope is every tracked file in this worktree. Source searches cover tests,
fixtures, native/platform scripts, desktop, CLI, relay, mobile, cloud, and build
code. Non-source assets/configuration/documentation are separately inventoried.
Dependency/build output outside the tracked file set is excluded from the
inventory; the installed xterm dependency was additionally inspected and exercised
because the retaining path crosses that boundary.

| Category       | Inventoried files |
| -------------- | ----------------: |
| Source         |            25,579 |
| Config         |               825 |
| Documentation  |               281 |
| Asset/other    |               214 |
| **Total rows** |        **26,899** |

The [file inventory](./memory-leak-file-inventory-2026-09-15.tsv) records size and
SHA-256 for every tracked path except the inventory itself. That self-exclusion
avoids a circular hash; symlinks are hashed as link text. Thus 26,899 rows plus
the inventory account for 26,900 tracked paths. Hashes describe the final
worktree contents, including staged evidence files, rather than only HEAD.

The [mechanical search results](./memory-pattern-scan-2026-09-15.json) record
25,579 source files searched and per-file hits for listener, timer,
subscription, disposal, Map/Set, and buffer-concatenation signals. Zero-hit source
files remain represented in the inventory. These searches include comments and
tests; unequal add/remove counts do not establish a leak. Candidate review traced
owners, cleanup, caps, and production callers, with tests or isolated experiments
for actionable findings. This is repository-wide coverage plus targeted manual
analysis, not a claim that every line was manually proven safe.

Regenerate both mechanical artifacts after staging any new files:

```sh
python3 docs/audits/refresh-memory-scan.py
```

Manual review and issue correlations are maintained in the ledger; rerunning the
script does not redo that reasoning. The earlier audit used repository-scoped
`rg` searches for event `.on`/`.once`/`.off`, React effects, disposal hooks, timers,
long-lived containers, and factory ownership as well.

## Validation

The ledger records per-change test runs and their limits. The latest terminal-tail and observed-exit fixes add 50 and 66 selected tests, respectively, with bounded portable proofs and independent review. Full desktop typecheck and the changed-code gate pass after both commits. Full desktop typecheck,
mobile typecheck, targeted lifecycle/stream/snapshot/fidelity tests, lint,
formatting, and changed-code quality passed. The final hyperlink pass included
62 desktop tests and 15 mobile engine/init tests. The retained-string passes ran
41 CI/provider/helper tests, 69 terminal-buffer tests, and 28 error/reattach/heap
tests, followed by a final 63-test run. Transcript verification ran 71 tests
and a ten-test reader/recovery pass. WebGL cache verification adds 86 tests and
six 100,000-redraw runs against actual bundles in headless Chromium, including
shared-terminal pixel checks; these per-run test counts overlap. Reproduction artifacts retain
before/after samples and source bundle hashes. The resumed pass adds 164 PTY detector tests, 50 legacy-import/decoder tests, 177 structured-hold tests, 26 scanner cancellation tests, 59 search-writer/consumer tests, and 112 Claude tracker/copier tests with 36 memory proof cases. Contrast validation includes 122 desktop tests, a 90-test generator/cache/CI pass, 23 mobile engine/theme tests, six WebGL runs, 12 desktop DOM cases, and eight mobile DOM cases; these counts overlap. Cell retention adds 127 main emulator/snapshot/fidelity tests, two generated mobile-engine tests, 45 generator tests, 51 upstream BufferLine tests, 25,000 independent semantic comparisons, and 70 actual-bundle memory cases. Hydration ownership adds 22 actual-runtime cases and a 306-test filtered regression pass. Physical-exit reconciliation adds 88 tests and four real-socket before/after scenarios; pending split close adds 200 renderer tests and 24 proof cases. Both passed independent review, full desktop typecheck, standalone React Doctor and changed-code checks. TUI transcript cleanup adds seven tests and four actual-host before/after cases with independent review. Scoped remote pending-close adds 255 renderer tests and 15 before/after cases; TUI acquisition adds seven actual-host before/after cases plus six replacement/ownership cases. Both portable proofs, full desktop typecheck, standalone React Doctor, and the changed-code gate passed after commit. Full desktop/mobile typechecks and the changed-code quality gate passed again after these changes. No affected-host heap capture was
available, and no application windows were opened.

### Remote CI follow-up

Local verification is separate from GitHub CI. The [CI ledger](./memory-pr-validation-2026-09-16.json) records reviewed failures, corrected test/proof issues, branch-specific mobile payload hashes, and current head statuses. Several merge-tree runs fail on an unused type import introduced by main #20898; the audit patches do not touch that file. Two runs also failed in untouched watcher/React teardown fixtures. No all-green CI claim is made.
