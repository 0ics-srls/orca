# Memory audit: PR review and merge handoff

**Audit discovery stopped at the user's request after finishing the current fixes. 59 open PRs: 54 target main and five are stacked.** No PR was merged by this audit.

CI snapshot: **2026-09-17T07:26:27.577402+00:00** — **31 passing, 25 failing, 3 pending**, 0 without checks. These counts describe PR rollups; a failing rollup can still have running jobs. Status is an observation of the exact recorded head, not merge approval. [Complete heads and check URLs](./memory-pr-handoff-status-2026-09-17.json).

## Suggested review order

This order weighs the reproduced allocation mechanism and patch scope, not a measured frequency on affected hosts. Independent PRs can be reviewed in parallel.

| Batch | PRs | Why review together |
| --- | --- | --- |
| Contained allocation/retention fixes | [#20960](https://github.com/stablyai/orca/pull/20960), [#20963](https://github.com/stablyai/orca/pull/20963), [#21131](https://github.com/stablyai/orca/pull/21131), [#21135](https://github.com/stablyai/orca/pull/21135), [#21150](https://github.com/stablyai/orca/pull/21150), [#21164](https://github.com/stablyai/orca/pull/21164) | Oversized backing strings/records and completed queue/result owners; bounded before/after evidence with relatively contained ownership changes. |
| Sustained output/cache growth | [#20947](https://github.com/stablyai/orca/pull/20947), [#20949](https://github.com/stablyai/orca/pull/20949), [#20965](https://github.com/stablyai/orca/pull/20965) | Stalled daemon/CDP consumers and invisible glyph caching can grow substantially; review backpressure and rendering controls. |
| Terminal engine changes | [#20955](https://github.com/stablyai/orca/pull/20955), [#20981](https://github.com/stablyai/orca/pull/20981), [#20992](https://github.com/stablyai/orca/pull/20992), [#21112](https://github.com/stablyai/orca/pull/21112) | Overlapping desktop/headless/mobile engine patches and generated payload checks need coordinated integration. Follow the stack below. |
| PTY/session lifecycle | [#21000](https://github.com/stablyai/orca/pull/21000), [#21001](https://github.com/stablyai/orca/pull/21001), [#21005](https://github.com/stablyai/orca/pull/21005), [#21011](https://github.com/stablyai/orca/pull/21011), [#21019](https://github.com/stablyai/orca/pull/21019) and the related rows below | Preserve live/replacement owners and execution-host authority. Follow the two lifecycle stacks below. |
| Latest ownership fixes | [#21175](https://github.com/stablyai/orca/pull/21175) paired-server state and [#21178](https://github.com/stablyai/orca/pull/21178) closed editor models, plus [#21185](https://github.com/stablyai/orca/pull/21185) plugin uninstall logs | Each includes independent review, regression tests, portable evidence, and explicit limits. Wait for current-head CI where still pending. |
| Remaining focused cleanups | All remaining rows below | Useful local lifetime fixes; the audit does not claim each can explain multi-GiB OOMs. |

## Required dependency order

| Parent | Then merge | Then merge |
| --- | --- | --- |
| [#20981](https://github.com/stablyai/orca/pull/20981) contrast cache | [#20992](https://github.com/stablyai/orca/pull/20992) erased-cell strings | [#21112](https://github.com/stablyai/orca/pull/21112) reflow rows |
| [#21001](https://github.com/stablyai/orca/pull/21001) pending IPC pane close | [#21005](https://github.com/stablyai/orca/pull/21005) scoped remote pending close | — |
| [#21000](https://github.com/stablyai/orca/pull/21000) physical exit reconciliation | [#21011](https://github.com/stablyai/orca/pull/21011) queued graph and [#21019](https://github.com/stablyai/orca/pull/21019) observed exit | These two children are siblings. |

After merging a parent, retarget/rebase its child while retaining only the intended child change, then validate the resulting head. For combined xterm changes, regenerate each target's mobile payload and its exact length/hash guard. The prior combined PTY graph/inventory control is recorded in the [validation ledger](./memory-pr-validation-2026-09-16.json); it is not a substitute for checking the final merge tree.

## CI and review caveats

The 25 older failing heads share a proven inherited main regression: an unused `NativeChatMessage` type import in `NativeChatMessageList.windowing.test.tsx`, following #20898. Root verified at 2026-09-17 07:01:31 UTC that current main blob `b843a6bdc5dd0b12d64809d21c7649160e0f3747` has removed that import: refresh the old PR bases and rerun their checks. Several also have separate watcher, timing, or React teardown failures. A failed job is not dismissed merely because the PR does not edit its test file. [Failure-by-failure review](./memory-pr-ci-review-2026-09-17.md) and [correction/evidence ledger](./memory-pr-validation-2026-09-16.json) distinguish the known baseline error, corrected introduced defects, and unresolved causes.

The newest corrections address introduced publication issues: #21175's permanent test now matches main's one-argument session registration signature, while its audit-branch variant retains the separate runtime argument; #21178's actual Monaco attachment fixture uses checked direct calls instead of reflection forbidden by CI. Their evidence records both failed and corrected heads. The plugin fixture also passes the explicit anti-slop gate before publication.

Check the exact current head before merging. Passing CI does not establish incident causality; red/pending rows still require their listed checks to be resolved or reviewed through the repository's normal merge process. This handoff does not request bypassing checks.

## Complete PR list

### Passing CI (31)

| PR | Change | Base / prerequisite |
| --- | --- | --- |
| [#20903](https://github.com/stablyai/orca/pull/20903) | fix(renderer): clear terminal editor close timers on unmount | main |
| [#20904](https://github.com/stablyai/orca/pull/20904) | fix(renderer): cancel deferred diff model disposal | main |
| [#20905](https://github.com/stablyai/orca/pull/20905) | fix(renderer): cancel signout auth retry on unmount | main |
| [#20924](https://github.com/stablyai/orca/pull/20924) | fix(renderer): release parked terminal scroll intents | main |
| [#20946](https://github.com/stablyai/orca/pull/20946) | fix(relay): bound cyclic process-table traversal | main |
| [#20947](https://github.com/stablyai/orca/pull/20947) | fix(daemon): pause producers when stream backlogs grow | main |
| [#20949](https://github.com/stablyai/orca/pull/20949) | fix(browser): bound CDP output for stalled clients | main |
| [#20960](https://github.com/stablyai/orca/pull/20960) | Detach retained CI and terminal tails from oversized strings | main |
| [#20963](https://github.com/stablyai/orca/pull/20963) | Bound AI Vault transcript record assembly before allocation | main |
| [#20965](https://github.com/stablyai/orca/pull/20965) | Bound invisible WebGL glyph cache entries | main |
| [#20976](https://github.com/stablyai/orca/pull/20976) | Enforce the legacy transcript import budget while reading | main |
| [#20980](https://github.com/stablyai/orca/pull/20980) | Release completed scanner cancellation IDs | main |
| [#20992](https://github.com/stablyai/orca/pull/20992) | fix(terminal): release erased cell backing strings | [#20981](https://github.com/stablyai/orca/pull/20981) |
| [#21024](https://github.com/stablyai/orca/pull/21024) | fix(claude): stream transcript ancestry proofs | main |
| [#21112](https://github.com/stablyai/orca/pull/21112) | fix: stop xterm reflow retaining and overwriting trimmed rows | [#20992](https://github.com/stablyai/orca/pull/20992) |
| [#21113](https://github.com/stablyai/orca/pull/21113) | fix: persist closing never-started local terminal tabs | main |
| [#21128](https://github.com/stablyai/orca/pull/21128) | fix: enforce the crash dump size limit during reading | main |
| [#21129](https://github.com/stablyai/orca/pull/21129) | fix: bound audio queued behind local speech recognition | main |
| [#21131](https://github.com/stablyai/orca/pull/21131) | fix: release completed runtime RPC queue payloads | main |
| [#21135](https://github.com/stablyai/orca/pull/21135) | fix: release aborted auth filesystem waiters | main |
| [#21136](https://github.com/stablyai/orca/pull/21136) | fix: retire stale GitLab host cache generations | main |
| [#21138](https://github.com/stablyai/orca/pull/21138) | fix: release Codex prompt claims after turn completion | main |
| [#21139](https://github.com/stablyai/orca/pull/21139) | fix: release completed terminal spawn inputs | main |
| [#21140](https://github.com/stablyai/orca/pull/21140) | fix: release native PTY spawn environment after setup | main |
| [#21142](https://github.com/stablyai/orca/pull/21142) | Skip empty chunks in streamed agent text | main |
| [#21144](https://github.com/stablyai/orca/pull/21144) | fix: release canceled working-directory waiter references | main |
| [#21150](https://github.com/stablyai/orca/pull/21150) | fix: release completed SSH writer queue entries | main |
| [#21160](https://github.com/stablyai/orca/pull/21160) | fix: fence viewport state after browser guest retirement | main |
| [#21162](https://github.com/stablyai/orca/pull/21162) | fix: release retired daemon owner incarnation metadata | main |
| [#21164](https://github.com/stablyai/orca/pull/21164) | fix: release completed browser results after host close | main |
| [#21167](https://github.com/stablyai/orca/pull/21167) | fix: avoid retaining foreign SSH file frames before metadata | main |

### Failing CI — review the recorded leaf failures (25)

| PR | Change | Base / prerequisite |
| --- | --- | --- |
| [#20906](https://github.com/stablyai/orca/pull/20906) | fix(renderer): cancel copied prompt reset on unmount | main |
| [#20908](https://github.com/stablyai/orca/pull/20908) | fix(renderer): dispose global listeners during HMR | main |
| [#20909](https://github.com/stablyai/orca/pull/20909) | fix(main,preload): tear down renderer relay and preload listeners | main |
| [#20910](https://github.com/stablyai/orca/pull/20910) | fix(main): release hang watchdog quit listener on shutdown | main |
| [#20941](https://github.com/stablyai/orca/pull/20941) | fix(stats): bound retained events during stalled writes | main |
| [#20955](https://github.com/stablyai/orca/pull/20955) | Fix terminal hyperlink metadata retention during redraws | main |
| [#20978](https://github.com/stablyai/orca/pull/20978) | Release provider children after structured session holds disappear | main |
| [#20981](https://github.com/stablyai/orca/pull/20981) | Bound terminal contrast-color caches | main |
| [#20986](https://github.com/stablyai/orca/pull/20986) | fix(ai-vault): release retired search write fences | main |
| [#20996](https://github.com/stablyai/orca/pull/20996) | fix(runtime): fence terminal snapshot completion by owner | main |
| [#21000](https://github.com/stablyai/orca/pull/21000) | fix(pty): reconcile daemon exits after synthetic notifications | main |
| [#21001](https://github.com/stablyai/orca/pull/21001) | fix(terminal): retire explicitly closed pending split connections | main |
| [#21002](https://github.com/stablyai/orca/pull/21002) | fix(sessions): stop transcript catch-up after TUI owner close | main |
| [#21005](https://github.com/stablyai/orca/pull/21005) | fix(terminal): retire captured remote handles when pending panes close | [#21001](https://github.com/stablyai/orca/pull/21001) |
| [#21006](https://github.com/stablyai/orca/pull/21006) | fix(sessions): cancel transcript acquisition during host teardown | main |
| [#21009](https://github.com/stablyai/orca/pull/21009) | fix(log-tail): retire watches with their renderer lifetime | main |
| [#21010](https://github.com/stablyai/orca/pull/21010) | fix(browser): release page callbacks when a guest is destroyed | main |
| [#21011](https://github.com/stablyai/orca/pull/21011) | fix(runtime): preserve exited PTY authority across queued graphs | [#21000](https://github.com/stablyai/orca/pull/21000) |
| [#21012](https://github.com/stablyai/orca/pull/21012) | fix(browser): fence late registration replies to their guest owner | main |
| [#21014](https://github.com/stablyai/orca/pull/21014) | fix(runtime): reject stale inventory after PTY lifecycle changes | main |
| [#21018](https://github.com/stablyai/orca/pull/21018) | fix(runtime): terminate nonblank tail scan at the first row | main |
| [#21019](https://github.com/stablyai/orca/pull/21019) | fix(runtime): preserve observed exit during explicit terminal close | [#21000](https://github.com/stablyai/orca/pull/21000) |
| [#21020](https://github.com/stablyai/orca/pull/21020) | fix(runtime): persist acknowledged terminal tab retirement | main |
| [#21021](https://github.com/stablyai/orca/pull/21021) | fix(claude): enforce history window quota while reading | main |
| [#21022](https://github.com/stablyai/orca/pull/21022) | fix(projects): release processed repository scan records | main |

### CI still running (3)

| PR | Change | Base / prerequisite |
| --- | --- | --- |
| [#21175](https://github.com/stablyai/orca/pull/21175) | fix: retire unowned paired-host session partitions on GUI removal | main |
| [#21178](https://github.com/stablyai/orca/pull/21178) | fix: retire closed editor models from the app shell | main |
| [#21185](https://github.com/stablyai/orca/pull/21185) | fix(plugins): retire log owners after successful uninstall | main |

## Coverage and work left at the pause

- Every tracked path is accounted for in the [file inventory](./memory-leak-file-inventory-2026-09-15.tsv). The [mechanical source scan](./memory-pattern-scan-2026-09-15.json) covers the complete tracked source set. Manual investigation followed candidate owners and lifetimes; this is not a claim that every line is proven leak-free.
- The [expanded issue index](./expanded-memory-body-review/candidate-index.json) has 201 discovery candidates. All 134 newly fetched bodies and their complete comments were read. These counts include historical controls and lexical false positives, not 201 memory leaks or 201 solved incidents.
- #19831 and #19768 remain causally unattributed. Real large-growth mechanisms were reproduced, but no affected-host process/heap evidence is available. #19831's 16.2 GB memory and 15.2 GB swap values are separate maxima and must not be added as simultaneous usage.
- Evidence-only follow-ups remain: [scanner quit custody](./scanner-shutdown-custody/README.md), [native AppImage/runtime and React crash review](./native-and-react-crash-body-review/README.md), and [hidden-worktree terminal creation](./hidden-worktree-terminal-create/README.md). No new fix for these was started after the pause request.
- Renderer paired-host remnants and hydration timing remain separate from #21175's main-profile retirement. Existing historical partitions and CLI removal are outside that PR's boundary.
- [Historical editor restart growth](./mirrored-editor-restart-growth/README.md) and [Codex hook stdin lifetime](./codex-hook-stdin-lifetime/README.md) retain their own source/version limits. They are not new PR claims.

The unsafe prior daemon background-retirement proposal #20925 is closed/reverted and excluded. Related pre-existing PRs discussed in issue triage are not counted as this audit's output. The [audit summary](./memory-leak-audit-2026-09-15.md) and [detailed findings](./memory-leak-scan-2026-09-15.md) preserve the broader evidence for a future continuation.
