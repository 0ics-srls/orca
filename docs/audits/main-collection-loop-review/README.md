# Main-process collection mutation review

Follow-up to #19768's repeated main-thread samples. This narrows one synchronous-allocation hypothesis: extending a collection while iterating it can make an otherwise ordinary `for...of` loop run indefinitely.

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/main-collection-loop-review/scan.cjs
```

The recorded scan parses 6,239 tracked main/shared TypeScript files and examines 3,876 `for...of` loops. It finds 14 sites that directly call `set`, `add`, `push`, or `unshift` on the same written receiver expression. Every returned site was read with its surrounding branches. All 14 update an existing Map key without deleting and reinserting that key on the same path. No growing iteration was found in these matches.

| Site                                          | Observed update                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Claude and Codex subagent rosters             | Replace the current entry's state; emit after the loop.                                          |
| SSH PTY projection terminality                | Retain the same key's pending waiters, or delete it; promise resolution schedules continuations. |
| SSH PTY source obligations                    | Replace existing consumer obligation under the same key.                                         |
| Worktree marker poller                        | Replace existing first-seen tick with null.                                                      |
| Worktree HEAD identity reader                 | Replace existing name, or delete it.                                                             |
| Agent-session backup recovery and store queue | Replace existing session records under the same session ID.                                      |
| Remote desktop terminal floor                 | Replace existing viewer subscription; apply layout after iteration.                              |
| Browser page registry                         | Replace existing page state under the same page ID.                                              |
| SSH multiplexer health clocks                 | Replace existing sequence timestamp.                                                             |
| SSH relay model recovery                      | Replace existing PTY migration promise; no synchronous new map entry.                            |
| Claimed agent PTY owners                      | Replace remaining conflict list, or delete that key; promoted singleton goes to a different map. |
| Plugin extension registry                     | Replace existing point's filtered registrations.                                                 |

`results.json` includes exact source hashes and call text for these matches. The full tracked-file inventory supplies the broader file list. This scan does **not** resolve aliases, inspect called functions for mutation, prove callbacks cannot mutate the collection, examine every other loop kind, or replay the reported release. It is source-level negative evidence, not an incident explanation or a general proof of termination.

Additional targeted reads checked that project-group traversal has a visited set; structured-TUI descendant and exclusion traversals reject visited PIDs; the foreground ancestor walk has a cycle guard; RPC pane/orphan input has 64-depth/1,024-node bounds before traversal; normal Codex directory enumeration ignores symlinks and the incremental variant yields after batches; nested-repo discovery excludes symlinks, caps traversal depth and returned repositories, and checks an optional time limit. The consumed-directory retention is now separately fixed in [#21022](https://github.com/stablyai/orca/pull/21022); its active frontier still has no directory-count or retained-byte cap. Terminal legacy alternate-screen scanning advances past each token, shell identity scanning consumes a character or returns, and JPEG/WebP dimension scans advance across each segment. Those reads found no additional cyclic or non-progressing traversal; they do not establish a bound independent of input size.

The existing shared process-table walker finding and separate relay walker remain recorded elsewhere; this review does not supersede either. No affected-host data or heap was used.

## Further native-allocation and progress checks

The follow-up inspected renderer PTY admission/flush/accounting/reset code: ordinary chunks have per-PTY and global in-flight credit checks, pending output drops to a restore sentinel at its per-PTY cap, and a missing resync reply does not release credit. A lifecycle reset clears visibility/accounting for the dead page. These source checks do not measure Chromium's native IPC queue or establish a global memory cap across arbitrary pane counts and lifecycle resets.

Other targeted reads found existing safeguards: browser tunnel frame decoding caps frame and retained bytes and advances its offset; receive queues consume entries while honoring credit; scrcpy frames cap at 16 MiB and copy retained packet data; MJPEG pending data copies a capped suffix; diagnostic uploads cap response bytes; native-chat edit LCS uses a 200,000-cell threshold before a linear fallback; terminal redraw rows grow only on consumed newlines and trim to the retained line limit. Native-image capture and tray paths were read without finding a persistent image collection in those files. A native capture that never settles is a separate lifetime question, not disproved by a JavaScript timeout.

PTY grid validation checks finite positive sizes but does not impose a common upper bound at every local/main/daemon entry. Some RPC and history routes have separate limits. A large requested grid can cause a large finite allocation; no ordinary producer of incident-scale dimensions or low-risk universal sizing policy has been established here. This is not counted as a proven new leak.

## Additional synchronous-loop review

A broader mechanical candidate list contains 216 `while`/`do`/`for` sites with collection-growth calls. That list has not been completely manually reviewed. Targeted follow-up found these concrete progress properties:

- Managed TOML scanning advances to a newline/end or a recognized positive-width region; its outer index increments after an unmatched marker.
- Safari cookie offset arrays are bounded by readable file/page data; invalid binary offsets throw.
- Browser partition-capacity eviction deletes an existing victim or throws when none can be evicted.
- The provider-error traversal rejects previously visited objects. Very large spread arguments can still throw; the review does not claim a general input-size bound.
- Git admission retries an aborted selected waiter through the actual controller's abort/dequeue path. Candidate lists are rebuilt per iteration, not appended across retries.
- The host-balanced listing loop consumes one row per active bucket and removes exhausted buckets.
- Cron ranges validate the domain and a positive integer step; production domains are finite calendar fields.
- Codex session counting consumes a directory stack and ignores symlinks. Its 100-file stopping limit does not cap the number of directories without matching files. Date-gap enumeration advances a UTC day; the bounded expansion wrapper checks range size before enumeration.
- Git octal path decoding advances the byte escape position; UI Automator XML parsing consumes input, returns, or throws on malformed delimiters. Deep recursive XML remains an input-depth risk rather than a demonstrated growing loop.
- Offline speech chunking consumes at least one sample on every iteration. The separate delivery queue before that handler is now reproduced in the [speech worker diagnostic](../speech-worker-audio-queue/README.md).

These are source-level checks of specific progress paths, not proof that all 216 candidates terminate or that native callees cannot stall.

A further [25-site manual review](./additional-sites.md) records progress, ownership and caller limits for each site, with exact source hashes in [its manifest](./additional-sites.json). It found no growing synchronous iterator. Surrounding input-size and stale-generation candidates remain explicitly identified for follow-up.

A [further twelve-file review](./further-progress-sites.md) checks ancestor/union-find progress, callback rescheduling, worker-slot disposal, naming retries, cache eviction, relay framing and bounded-buffer comparison. It records input-size and native-I/O limits alongside the observed progress properties; it does not clear every unreviewed candidate.

Another [twenty-site review](./twenty-additional-sites.md) covers browser command settlement, plugin ownership, SSH delivery, transcript fan-out, Codex registries, observability and certificate decisions. It records [source and supporting hashes](./twenty-additional-sites.json), identifies a separate prompt-claim ownership candidate, and preserves the certificate-history security requirement. No growing synchronous production iterator was established in that selected batch.

The prompt-claim follow-up now has an [actual cancellation/completion proof](../codex-prompt-claim-retention/README.md) and separate fix [#21138](https://github.com/stablyai/orca/pull/21138). It releases claims after accepted exact-turn completion; active claims remain owned. The earlier review manifest retains its source hashes from before that change.

A [twelve-file progress and retention follow-up](./twelve-retention-sites.md) covers output framing, title/query parsing, bounded metadata and image probing. It records the Codex reader's intentional infinite record allowance and a separate kitty escape-tail backing-string candidate, without treating logical length caps as owned-memory bounds.

## Further ownership checks

A further [twenty-site review](./twenty-main-shared-loop-sites.md) covers transport
admission, terminal parsers, native-provider framing, journals and package output.
Its [ordinary RPC diagnostic](../rpc-inflight-admission-review/README.md) separates
pending ordinary provider calls from bounded long polls. A separate
[byte-accounting and shared-wait review](./byte-accounting-and-wait-boundaries.md)
records 28 primary/supporting source reads and an API-only cancellation-slot
case that has no production caller in this checkout. These findings are not a
claim that every remaining mechanical candidate has been manually reviewed.

A [six-site stream accounting review](./six-stream-accounting-sites.md) records
38 source/caller hashes. It found the separate SSH writer consumed-prefix defect,
while distinguishing ordinary producers from malformed-peer empty chunks and
unused buffer APIs. Its source manifest preserves the pre-fix checkpoint.

- GitLab admission removes each selected entry before granting it; timeout removes its own queued entry and clears its timer. Reviewed issue, merge-state and authentication callers release their acquired slot in `finally`. This is a lifetime bound on queued waits, not an aggregate request-byte limit.
- Workspace-space traversal advances each frame index and retires its entry array after dispatch. Local classification uses `lstat`; remote classification checks symlink identity before descending. Listing admission enforces 100,000 entries per directory and an estimated 64 MiB live-listing budget. Completed parent aggregates and active jobs are separate from that charge, so the budget is not a whole-process or arbitrary-depth bound.
- Plugin language-catalog traversal removes a frame per iteration and rejects repeated/cyclic objects, depth over 16, or more than 20,000 entries. The JSON parse and `Object.keys` allocation occur before those traversal checks; this does not prove a pre-parse byte bound.
- Grok session lookup shifts each admitted pending entry, caps its pending/cache maps at 64, runs at most four distinct roots, and removes in-flight/root ownership in `finally`. A stalled scanner retains its active slot; strict FIFO can delay unrelated roots but does not expand the queue past its cap.
- WSL auth filesystem admission removes queued work before starting and removes aborted queued entries. Its three reviewed callers coalesce a raw operation by path until actual settlement. The follow-up [auth waiter proof](../auth-filesystem-wait-retention/README.md) reproduces retained expired Errors on Electron and verifies detachable waiters preserve ordering. [#21135](https://github.com/stablyai/orca/pull/21135) removes those reactions; no actual native filesystem stall or incident magnitude was established.

The follow-up also traced several shared-promise callers. Worktree metadata resolution races a fresh filesystem traversal on each call, so a timeout does not itself demonstrate repeated reactions on one shared promise. WSL environment probes cap subprocess output at 64 KiB and execution at ten seconds; process-table evidence joins a capture with its own longer timeout. Those controls limit ordinary reaction lifetime while leaving operating-system stalls separate. The desktop script request queue retains expired closures behind its predecessor, but its actual host aborts and rejects the active request on a timer and limits startup retries. No indefinitely pending ordinary producer was established in that review. Daemon shared preparation and terminal creation waits remain additional candidates for cancellation-lifetime analysis.

## Consumed-prefix comparison

The SSH writer finding prompted targeted comparison of other cursor-based owners.
`RelayFrameBuffer` and the relay dispatcher writer clear consumed slots and
compact the prefix. `RecentPtyOutputBuffer` clears fully dropped string slots,
compacts after 1,024 drops, rejects empty appends and preserves the partially
consumed head for its documented candidate-backfill obligation. Relay sent
boundaries retain primitive sequence numbers and compact when the dropped prefix
occupies at least half the array. Source-credit delivery retains sent spans until
credit acknowledgement, then shifts reclaimed spans and adjusts its send cursor;
selection alone does not end that ownership.

Git admission compacts its consumed prefix at 256 entries and separately filters
canceled tombstones. Its candidate heaps discard invalid roots and rebuild when
storage exceeds twice the live-lane count plus 64. These policies can retain
bounded stale records between compactions; they do not match an indefinitely
growing consumed prefix. The shared concurrency mapper retains its input and
ordered result arrays for the batch lifetime; worker count is a concurrency
limit, not a total input-memory cap. A rejected worker does not cancel sibling
workers, so a caller's rejection alone does not end their ownership.

These are targeted source observations, recorded in
`consumed-prefix-comparison.json`, not a universal capacity proof or a claim that
native operations always finish. The SSH scheduler's distinct completed-entry
path has its own actual-source before/after proof.

The [callback iteration review](./callback-iteration-review.md) adds five selected
sites and one supporting source. The [next twenty-site review](./next-twenty-loop-sites.md)
records 90 source/caller hashes, including the now-fixed OSC 133 carry and separate
SSH pre-metadata, plugin audit-write and forced skill-refresh leads. The saved
518-hit search inventory is a candidate list; the earlier 216-site selection was
not recovered, so these reviews do not establish that all 216 sites were read.
