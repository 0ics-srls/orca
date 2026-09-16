# Memory leak audit (2026-09-15)

The audit produced **16 separate PRs**, each based on `main`. The largest new
reproduced mechanisms are terminal hyperlink metadata retention, stalled daemon
output, stalled CDP delivery, oversized strings retained by small text tails,
unbounded transcript record assembly, and invisible WebGL glyph caches. They establish real defects in code paths that
can consume large amounts of memory; **they do not prove the cause of #19831 or
#19768**. Affected-host data is unavailable, and the issue map keeps that limit
explicit.

## Results

| Mechanism | Evidence and fix |
| --- | --- |
| OSC 8 hyperlinks survive cell overwrite | A real 24-row terminal retains 10,000 historical link entries, about 20.5–20.9 MB after GC; collection reduces the same run to 1.6–1.7 MB. Covers headless mirrors/daemons, desktop panes/previews, and mobile. [#20955](https://github.com/stablyai/orca/pull/20955), [reproduction](./osc-link-retention/README.md). |
| Daemon held-queue valve moves backlog into the socket | A paused reader retains another 66.4 MB in the socket after 96 MiB of input while the held queue stays near 32 MiB. Producer backpressure and hidden-output shedding bound accumulation in the fixed reproduction. [#20947](https://github.com/stablyai/orca/pull/20947), [reproduction](./daemon-stream-retention/README.md). |
| CDP client stops reading | The baseline retains 133,177,280 queued bytes after a 128 MiB burst. The fix bounds backlog with the existing outbound queue and terminates overflowing clients. [#20949](https://github.com/stablyai/orca/pull/20949), [reproduction](./cdp-stream-retention/README.md). |
| Small CI/terminal tails retain oversized parents | Eight capped CI excerpts retained 16–32 MiB; eight error strings totaling 32,000 characters retained 32 MiB; terminal tails reporting 4 MiB retained 32 MiB. Copying at retention boundaries reduces them to about 0.1–0.15 MiB, 33 KiB, and 4 MiB. [#20960](https://github.com/stablyai/orca/pull/20960), [reproduction](./retained-text-slices/README.md). |
| AI Vault assembles an oversized transcript record | A 64 MiB record peaks near 248 MiB RSS despite the child’s 384 MiB old-space setting. Reusing the remote 10 MiB record cap stops at the cap plus one input chunk and peaks near 62 MiB. Failed scans preserve their previous resume point. [#20963](https://github.com/stablyai/orca/pull/20963), [reproduction](./transcript-record-retention/README.md). |
| Invisible WebGL variants bypass texture-page eviction | 100,000 colored-space redraws keep 100,093 entries and about 13.6 MB heap growth on one texture page. A separate 4,096-entry cap leaves 1,789 entries and about 0.2–0.4 MB growth in the reproduction, preserving shared terminals’ pixels. [#20965](https://github.com/stablyai/orca/pull/20965), [reproduction](./webgl-empty-glyph-retention/README.md). |
| Stats persistence stalls | The live event array exceeded its serialize-time cap. It now retains the newest 10,000 events on append. [#20941](https://github.com/stablyai/orca/pull/20941). |
| Process-table ancestry cycle | A two-row cycle exhausts an isolated 32 MiB heap in about 0.15 seconds. Existing [#20715](https://github.com/stablyai/orca/pull/20715) covers the shared walker; [#20946](https://github.com/stablyai/orca/pull/20946) fixes the independent relay walker. |
| Smaller lifecycle leaks | Eight PRs cover editor/diff/auth/prompt timers, renderer HMR listeners, main IPC relay/preload cleanup, watchdog listeners, and parked scroll-intent records. These are not gigabyte explanations. [Full PR list](./memory-leak-scan-2026-09-15.md#pull-requests). |

Risks differ by change. Hyperlink collection uses tested private xterm fields and
scans both buffers after registry growth; its CPU cost scales with scrollback.
Daemon backpressure depends on producer pause support. CDP overflow disconnects
the stalled client. Evicted invisible WebGL variants need rasterization when
revisited, while visible glyphs and texture pages stay intact. String copying costs scale with the retained caps and does
not reduce temporary original-input allocations. The transcript cap turns a
legitimate record over 10 MiB into a per-session scan issue and covers the
resumable JSONL route, not every whole-document/import reader. The timer/listener changes have smaller behavioral scope.
An unsafe legacy-daemon shutdown proposal was closed and reverted after review
found a race that could kill live work; it is excluded from the 16 fixes.

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
as did all six newly fixed string-retention boundaries. #15241 now has a
reproduced error-surface retention defect even though logical caps already existed.

## Coverage and reproducibility

The scope is every tracked file in this worktree. Source searches cover tests,
fixtures, native/platform scripts, desktop, CLI, relay, mobile, cloud, and build
code. Non-source assets/configuration/documentation are separately inventoried.
Dependency/build output outside the tracked file set is excluded from the
inventory; the installed xterm dependency was additionally inspected and exercised
because the retaining path crosses that boundary.

| Category | Inventoried files |
| --- | ---: |
| Source | 25,482 |
| Config | 781 |
| Documentation | 247 |
| Asset/other | 200 |
| **Total rows** | **26,710** |

The [file inventory](./memory-leak-file-inventory-2026-09-15.tsv) records size and
SHA-256 for every tracked path except the inventory itself. That self-exclusion
avoids a circular hash; symlinks are hashed as link text. Thus 26,710 rows plus
the inventory account for 26,711 tracked paths. Hashes describe the final
worktree contents, including staged evidence files, rather than only HEAD.

The [mechanical search results](./memory-pattern-scan-2026-09-15.json) record
25,482 source files searched and per-file hits for listener, timer,
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

The ledger records per-change test runs and their limits. Full desktop typecheck,
mobile typecheck, targeted lifecycle/stream/snapshot/fidelity tests, lint,
formatting, and changed-code quality passed. The final hyperlink pass included
62 desktop tests and 15 mobile engine/init tests. The retained-string passes ran
41 CI/provider/helper tests, 69 terminal-buffer tests, and 28 error/reattach/heap
tests, followed by a final 63-test run. Transcript verification ran 71 tests
and a ten-test reader/recovery pass. WebGL cache verification adds 86 tests and
six 100,000-redraw runs against actual bundles in headless Chromium, including
shared-terminal pixel checks; these per-run test counts overlap. Reproduction artifacts retain
before/after samples and source bundle hashes. No affected-host heap capture was
available, and no application windows were opened.
