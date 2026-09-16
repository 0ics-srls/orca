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
