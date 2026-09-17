# Twenty additional production loop/owner reviews

Reviewed at checkpoint `4a09b1d108cfd8b57ffcc5d727b3a3bd71ae71fb`. Selection, exclusions, original regex locations, and selection-time hashes are in the local `notes/main-growth-producers/speech-next-twenty-selected.json`; current source/caller hashes and structured conclusions are in `next-twenty-loop-sites.json`.

This is a bounded manual review of the 20 selected production paths. The saved inventory has **518 regex hits**. The separately reported 216 growth-call inventory was not recovered. This does not establish that either set is fully manually reviewed. Supporting callers and already fixed mechanisms are not additional new sites. In particular, WSL transcript gate/pool, node bounded reads, host-balanced listing, UIAutomator traversal, and the already fixed agent-status OSC suffix were removed from the selection after deduplication.

One new retained-parent mechanism has an actual-source before/after diagnostic: OSC 133 incomplete carry. Three other owner boundaries merit follow-up, but this review does not promote them to ordinary unbounded-growth findings: SSH pre-metadata foreign frames, forced skill-scan supersession under stalled native I/O, and plugin audit admission behind stalled filesystem work. Input-sized allocations and intentional authority history are recorded separately.

## 1. Hermes output Markdown

`src/main/automations/hermes-cron-output-markdown.ts` scans text without splitting every line: each heading loop advances to the next newline or the end; whitespace scanning increments its index; fence skipping advances beyond a complete fence or returns the end. Preview accumulation stops just above 180 characters, then clips. No persistent collection or non-progressing input branch was found.

Caller `src/main/automations/hermes-cron-output.ts` reads the **whole output file** before parsing, retains `outputContent` deliberately, and hydrates a requested page through `Promise.all`. The page-size-zero badge path reads references/counts only. The 5 MiB referenced-log constant is not a limit on the primary Markdown file. This leaves file/page-sized transient and returned allocations; a short preview does not bound those allocations. No stale-owner leak was established.

## 2. Browser command result cache

`src/main/browser/browser-client-host-command-result-cache.ts` evicts settled records by removing the record from all three indexes and the page's sequence array. An artificial mismatched PageState could make the loop fail to progress, but the real dispatcher/page helpers create a single record for each admitted monotonic sequence, reject sequence/command conflicts, set `settled` before caching, and only cache when removing the record from the active queue succeeds. Cache insertion/eviction is synchronous; Promise continuations do not interrupt the invariant.

`browser-client-host-command-dispatcher.ts` defaults to 64 cached results per page and 1,024 globally, 256 pages/active commands, eight running handlers, and 32 queued per page. Page retirement/replacement releases its cached records. Close drains to settlement or its join deadline; unresolved handlers retain their own custody. `src/shared/browser-client-automation-protocol.ts` allows results up to 768 KiB serialized and automation parameters up to 256 KiB. Therefore count bounds can still allow large memory, and serialized-byte limits are not exact heap limits. No cache-index non-progress bug was reachable through the reviewed dispatcher.

## 3. Incremental transcript reader

`src/main/native-chat/transcript-incremental-reader.ts` reads to a captured file end. Newline search and chunk offsets progress; per-record pending buffers are cleared on completion or on exceeding the 2 MiB record cap, with oversize bytes discarded until a newline. Empty slices cannot accumulate across records. The stream is destroyed in `finally`, and reset drops partial buffers.

`transcript-watch-engine.ts` supplies a callback for normal append delivery, draining batches of 40 messages. Its initial read without a supplied snapshot and `agent-session-wire/structured-tui-transcript-catchup.ts` recovery-gap read omit the callback and collect the full captured segment. Thus the record limit is not a total-message/output limit. Buffer subarrays can also keep their source chunk alive; reviewed WSL reads use 1 MiB chunks and local ReadStream chunking, so the partial-record logical count is not exact owned backing size. This is bounded by record/chunk input plus the selected segment, not a proven post-completion leak.

## 4. Headless automation output snapshot

`src/main/automations/headless-dispatch.ts` ignores empty appends, counts positive-length chunks, and removes a complete head or trims a positive excess on every overflow iteration. Logical text stays within 256 Ki characters. The boundary slice can share its parent, so the cap is not by itself a backing-memory guarantee.

Both production callers (`startup/main-process-automations.ts` and `automations/runtime-terminal-run-observer.ts`) create a local buffer, append one `readTerminal(..., {limit: 2000}).tail.join('\n')`, and immediately return its snapshot. This is not a demonstrated long-lived accumulated queue. The upstream terminal read/history owners have separate existing audits; this review does not reclassify a line count as a byte cap.

## 5. Session search retrieval

`src/main/ai-vault-search/session-search-retrieval.ts` pages recent rows in groups of 512. Each nonempty page increases the scanned offset; it stops at the candidate limit, an empty page, or 20 times the candidate limit. Session-ID lookup advances in batches of 500. The production engine defaults to 600 candidates. Returned arrays are call-local; later routes replace their predecessors.

The FTS query explicitly materializes/group-sorts every matching row before limiting distinct sessions. Its SQL temporary structures are not bounded by the returned 600 candidates. Recent `SELECT *` also materializes one 512-row page at a time. These are query/input-sized transient/native allocations, not evidence of persistent JavaScript owner growth. Constructor overrides are not independently normalized in this module; the production default is the bound traced here.

## 6. Advertised terminal URLs

`src/main/ports/advertised-url-watcher.ts` bounds never-bound PTYs to 32 entries of 16 Ki characters, evicting an actual oldest key on every loop. Existing `ownRetainedString` calls sever oversized pending input parents. Its `advertised-url-parsing.ts` per-PTY buffer keeps 4 Ki characters, copies oversized inputs, and bounds accepted URL candidates to 2,048 characters. The completed URL cache defaults to 256 entries.

Live bindings/buffers belong to PTYs; `orca-runtime-on-pty-exit.ts` and `ipc/pty/provider/state-cleanup.ts` unbind them. Runtime/worktree removal calls `forgetWorktree`, removing cache and scan metadata. `scanSnapshots` intentionally stores a fresh listener map per scanned worktree, so it scales with worktrees times observed ports and is not covered by the 256 URL-entry bound. Existing buffer-ownership fixes are supporting evidence, not a new mechanism in this batch. No new lost cleanup was established.

## 7. Plugin audit log

`src/main/plugins/plugin-audit-log.ts` reads recent lines backwards with a strictly decreasing end index. Normal records rotate a 10 MiB file to one predecessor. Recent output parsing is call-local. Rotation is not a bound on externally enlarged files or one individually oversized record; primary reads still materialize both files.

The write path chains each record behind `writeChain`. `plugin-host-methods.ts` awaits the intent write before mutating and awaits outcome recording; `plugin-host-process.ts` accepts each worker host call without a main-side concurrency counter and launches it asynchronously. The worker can issue concurrent host calls. Consequently a stalled first filesystem write can hold later validated calls/arguments and audit closures. No ordinary never-settling filesystem trigger or bounded actual-caller retention proof was run here. This is a **conditional admission lead**, not a claim that completed writes leak. Adding an arbitrary log-record drop would change the required audit-before-mutation semantics.

## 8. WSL skill enumeration protocol

`src/main/skills/skill-delete/wsl-enumeration-protocol.ts` parses NUL-delimited D/E/P records. Every valid record advances the index by its field count; malformed/unknown records throw. List-entry arrays scale with emitted entries; path inspections overwrite a map keyed by requested path. No retained parser state survives the call.

The actual `skill-wsl-install-filesystem.ts` caller executes batched read-only guest scripts with a 30-second timeout and a **128 MiB output bound** for enumeration, versus 64 KiB for ordinary mutation-command output. Splitting fields and constructing entries can consume substantially more heap than the wire string. This is finite but potentially large input amplification; it is not a small constant-memory parser or a proven lifetime leak. Reads use guest argv/path validation and the shared WSL runner.

## 9. Command Code transcript tail

`src/shared/agent-hook-listener/command-code-transcript.ts` scans backwards through at most 4 MiB in 64 KiB chunks. The outer offset decreases, partial-read offset increases, and a short/zero read stops. At most the scanned window is assembled for newline-free carry; an incomplete leading record at the budget boundary is not published. The descriptor closes in `finally`.

`provider-dispatch.ts` uses this reader from the transport-neutral `src/shared/agent-hook-listener.ts` normalizer, shared by main and relay listeners. It is not exclusively an external hook subprocess. Returned prompt text may approach the scan budget; downstream state ownership is separate. Synchronous filesystem delay blocks this call and does not itself create an asynchronous queue here. No new unbounded read or orphaned descriptor was found.

## 10. WSL skill observations

`src/main/skills/skill-discovery-wsl-observation.ts` consumes fields on every R/S record and rejects malformed input. Base64 Markdown is decoded then reduced to a summary; returned rows retain summaries/paths/provider metadata, not an intentional whole-Markdown field. Projection creates new filtered/deduplicated rows and copies mergeable arrays.

`skill-discovery-wsl.ts` executes a 10-second guest scan, reads at most 256 KiB Markdown per skill, and caps combined command output at 128 MiB. Whole-output splitting/base64 decoding can still be large. `skill-discovery-target.ts` caches up to 32 target observations for ten seconds; root-level native cache capacity is separately 1,024. TTL expires on access rather than a proactive timer. Results scale with the number of skills in an accepted scan; no byte bound per cached observation was established.

## 11. Commit-message prompt preparation

`src/shared/commit-message-prompt.ts` advances section boundaries and tokenizer indices on every branch. Fair allocation either lowers remaining allowance, removes satisfied sections, or stops when no whole share remains. The local token/section arrays disappear with the call. `commit-message-generation.ts` and `pull-request-generation.ts` use the same truncator.

The nominal `STAGED_DIFF_BYTE_BUDGET` of 200,000 is implemented with JavaScript string length, so it bounds UTF-16 code units rather than UTF-8 bytes. Full diff splitting and section sizing occur before clipping. Input-sized transient arrays and the returned prompt remain possible; no immortal cache or non-progress loop was found. This review records the units without changing the established prompt semantics.

## 12. Shared text search

`src/shared/text-search.ts` resets its global regex before each line and explicitly increments `lastIndex` after a zero-length match, preventing that input from trapping the match loop. Accepted output uses the match accumulator's count/context limits: defaults 2,000 total matches and 500 context characters plus truncation markers. The rg argv also requests at most 100 matching lines per file; that is not a universal 100-submatch cap. Local and SSH callers reuse this parser.

The local git-grep fallback (`ipc/filesystem-search-git.ts`) detaches listeners and clears line state on completion/error/15-second deadline, even if child termination does not settle. Its line accumulator is instantiated with `Number.MAX_SAFE_INTEGER`; result caps therefore do **not** bound a raw newline-free input before parsing. That transport/input-frame mechanism is already covered by broader search-line audits and is not counted as a new fix here. User regex CPU cost is also separate from the loop's demonstrated progress invariant.

## 13. Hosted-review branch cache

`src/main/source-control/hosted-review-branch-cache.ts` bounds completed entries and joinable in-flight slots to 500 each. Eviction deletes oldest slots. In-flight entries have two-minute deadlines; token identity prevents an old completion deleting or publishing over its replacement. Keys include execution-host identity and options, avoiding local/remote collisions.

Importantly, removing a joinable slot does not erase underlying-work accounting: its companion unsettled-counter module limits two unresolved operations per key and 1,000 active keys; detached work has a separate 64 threshold for starting further work. These are not a single global limit of 64 existing operations. Actual settlement decrements counters. Cache invalidation preserves unsettled custody. Returned provider rows/keys are count-bounded, not given an exact byte budget. No new lost-ownership path was found in the reviewed call flow.

## 14. Jira image cache

`src/main/jira/attachment-image-cache.ts` evicts an actual oldest completed entry until it satisfies 96 entries/24 MiB charged binary bytes, and checks a 30-minute TTL on access. Base64 data URLs require additional encoded/string overhead. Global/site epochs prevent cleared or superseded requests publishing a stale entry or deleting a replacement.

`attachment-images.ts` selects at most 12 images, runs three downloads per issue call, enforces 2 MiB per completed image and 5 MiB per returned selection. However, `authenticated-request.ts` calls `response.arrayBuffer()` **before** checking those completed-image limits and supplies no task-specific abort deadline; the shared HTTP port adds none. The in-flight map coalesces a key but has no global key count. This leaves an input-sized response/allocation and concurrent-request boundary, not a leak of already-evicted completed cache entries. It overlaps the broader HTTP response-body audit; no novel stalled-network proof was added here.

## 15. SSH filesystem stream reader

`src/main/ssh/ssh-filesystem-stream-reader.ts` drains pending frames with `shift`, and subscription cleanup with `pop`; each loop shrinks its collection. Once metadata arrives, it rejects oversized advertised files before allocating (10 MiB text/50 MiB binary, tightened by caller limits), checks sequence and exact decoded chunk length, copies into the target buffer, acknowledges, and releases subscriptions/timers on success/failure/disposal. Metadata RPC defaults to 30 seconds; active streams have a suspend-aware 60-second inactivity deadline.

The **pre-metadata pending array receives every fs.streamChunk/end/error notification**, before it knows its own stream ID. Unrelated active streams can therefore contribute frames while this request's stat/metadata is delayed. Current relay production code has 16 stream slots, 256 KiB chunks, four-chunk acknowledgement pacing and writer backpressure; compatibility with older relays intentionally has no acknowledgement pacing. These limits and deadlines do not constitute a byte count on the pre-metadata array. After metadata it filters/drains; after timeout subscriptions disappear. This is a concrete **time-window retention/admission lead**, not demonstrated unlimited lifetime growth or permission to cancel other streams. A bounded delayed-metadata/foreign-stream caller proof remains future work.

## 16. Skill-scan coalescer

`src/main/skills/skill-scan-coalescer.ts` evicts completed LRU entries monotonically. Ordinary same-key calls join for 30 seconds; aged replacement aborts the old signal and counts it against 16 abandoned scans until real settlement. Promise identity fences publication and cleanup after replacement/clear. Production capacities are 1,024 native roots and 32 targets; ordinary native completed target results use TTL zero.

The comments and code deliberately exempt `refresh:true` from joining and abandonment accounting, and `clear()` drops pending slots without aborting work. Actual callers pass refresh after install/explicit rechecks. A native root `stat` can remain pending before abortable traversal begins; repeated forced refresh could supersede unresolved work. WSL scans instead run under a ten-second guest-command timeout. This is a **conditional forced-refresh/native-I/O lead**; no realistic repeated-trigger proof or overall install/recheck admission bound was established. Do not describe the 16 aged-scan budget as a universal live-scan cap.

## 17. SSH connection generations

`src/main/ssh/ssh-connection-generation.ts` retains the latest generation per target and all previously used session scopes. A scope rotates after 8,192 generation steps; search advances through already-used scopes until it finds a fresh one, then clears the target map. The huge finite scope namespace is checked for safe-integer tokens; exhaustion is not an observed ordinary trigger.

`ssh-provider-authority.ts` rotates tokens and aborts old registered requests; these retained generations prevent stale authorities becoming valid again. `ipc/ssh.ts` resets this state only in its explicitly named test teardown. The per-target map and used-scope set can grow with lifetime target/generation history. This is intentional anti-reuse authority state, not proven dead payload retention. Pruning by disconnection or treating loss of contact as process exit would be unsafe.

## 18. Wait-blocked scan carry

`src/main/runtime/wait-blocked-check-state.ts` ignores empty chunks and removes or shortens a positive-length head on every overflow iteration. It preserves 256 Ki characters and discards consumed array entries. The partial head can share a larger input backing string, so the character bound is not an exact heap bound.

The actual `orca-runtime-schedule-wait-blocked-check.ts` scans immediately on keywords or after its minimum 50 ms interval, otherwise owns one timer; the run clears appended carry, and state teardown clears the timer/map. This makes the append carry a short-lived throttle window under a progressing event loop, unlike the indefinite incomplete OSC carry. Existing owned keyword carry is separate. No new post-flush retention was shown.

## 19. Newest transcript-file selection

`src/main/ai-vault/session-newest-files.ts` uses a strictly narrowing binary-search interval, then one splice/pop, and refuses older candidates when full. Finite positive capacity preserves at most that many file records. `session-scanner-discovery.ts` streams discovered files to it rather than accumulating all matches first; recursive directory arrays themselves remain input-sized while their children are traversed.

`session-scanner.ts` deliberately chooses Infinity when `options.unlimited` is requested, otherwise positive limits; `session-scanner-source-discovery.ts` passes the per-agent limit through. The unlimited branch collects all discovered candidates for that requested scan. This is explicit whole-corpus work, not a hidden failure of the finite selector or a persistent selector owner after discovery returns.

## 20. OSC 133 incomplete carry — reproduced

`src/shared/terminal-osc133-command-finished.ts` makes progress over completed terminators and bounds its retained suffix to 4,096 characters, but retains `combined.slice(...)` without owning its backing string. Longer incomplete OSC 133 metadata can retain a large preceding PTY chunk until another chunk completes/replaces it or reset/disposal runs. This is distinct from the already fixed agent-status OSC, kitty, and mouse suffixes.

The ordinary sequence bytes come from the fish 4.7.1 capture documented in `src/shared/terminal-mode-2031-final-state.test.ts`: `A;click_events=1` and `C;cmdline_url=npx`. The diagnostic places those exact sequence bytes after a synthetic large plain-output prefix and splits before the terminator. It does not claim that the capture itself had that boundary or size.

`notes/osc133-carry-retention/probe.cjs` loads the actual scanner, actual `createTerminalTitleTracker`, and actual `BackgroundTransientFactRelay`, comparing unmodified source against an in-memory projection that applies existing `ownRetainedString` only to incomplete carry. Both Node 26.6 and Electron 43.7 / Node 24.21 pass **117 cases each**. Thirty-two 64 Ki-character parents retain roughly 2 MiB; eight 1 Mi-character parents retain roughly 8 MiB. The candidate releases those parents while preserving emitted callback/fact values. Short standard D;0 partials, completed frames, plain input, completion, reset, and relay lifecycle transitions are negative/cleanup controls. Oversized incomplete input is separately labelled malformed-protocol stress.

Actual daemon admission calls the relay before output batching; runtime creates a per-PTY tracker with `onCommandFinished`, subject to transient-fact authority/consumer enablement. Session exit/background retirement and runtime tracker disposal reset or drop owners. This is at most an incomplete-parent retention per live scanner, not cumulative retention of every historical chunk, not proof of native PTY chunk-size limits, and not incident/RSS attribution. The scanner copy is now published as the fifteenth retained-string boundary in [#20960](https://github.com/stablyai/orca/pull/20960); durable proof and compatibility controls are in [OSC 133 carry retention](../osc133-carry-retention/README.md).
