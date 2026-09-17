# Expanded issue-body discovery

The title catalog alone does not cover reports that mention memory only in their
bodies. Eight additional searches produced a union of **201 candidates** with the
prior 67-row catalog. This is a discovery count, not a count of memory defects or
completed manual reviews. It includes feature requests, lexical false positives,
and a closed historical control from the earlier catalog.

The `memory` body query returned 147 matches across two complete pages. The other
seven queries also completed; 134 additional issue bodies and all their comments
were fetched. [The candidate index](./candidate-index.json) records query matches,
body/comment hashes, links and explicit review status. All 134 additional bodies
and their complete comment threads have now been read. Causal code investigations
remain open where the evidence does not establish a mechanism. Raw read-only responses are retained locally under
`notes/expanded-memory-body-review/`; they are not required to interpret the index.

The [first 38 newly discovered issues](./lower-issue-triage.md) now have complete
body/comment triage, with 85 comments checked. Seven are resource/crash/growth
reports; the other 31 concern features or other functional bugs. This body review
does not claim a reproduced root cause for all seven. The current editor restart
path for #10859 is bounded by an existing deduplication fix. The
[20-case historical/current projection](../mirrored-editor-restart-growth/README.md)
reproduces the earlier per-restart growth and a separate current draft-loss
counterexample; it does not quantify the reported heap or replay a whole old app.

The [middle 40](./middle-issue-triage.md) add 54 comments and the
[higher-numbered 42](./high-body-review.md) add 39 comments. Their digests preserve
reporter corrections and distinguish disk growth, external process costs, native
crashes, ownership gaps, intentional limits and lexical false positives. Body
triage does not turn these candidates into proven memory leaks. The remaining
14 newly fetched reports have individual current-source reviews linked by the index.

## Corrections that affect attribution

- [#18839](https://github.com/stablyai/orca/issues/18839): the reporter's
  [correction](https://github.com/stablyai/orca/issues/18839#issuecomment-5552513459)
  identifies the crashing Node processes as agent/test children, while the daemon
  remained alive. The initial claim of an Orca runtime heap leak was retracted.
  Possible output amplification remains a question, not a demonstrated cause.
- [#16630](https://github.com/stablyai/orca/issues/16630): the reporter's
  [correction](https://github.com/stablyai/orca/issues/16630#issuecomment-5426032281)
  identifies a Jest/ts-jest invocation using the repository's unrestricted test
  command and 19 workers, followed by agent retries. The earlier explanation of
  an Orca restore fleet was retracted. Process containment and visibility remain
  separate requests; this is not evidence that Orca itself retained that heap.
- [#20995](https://github.com/stablyai/orca/issues/20995): both comments were read.
  The reported connection retention is specific to CLI removal. GUI removal
  already invalidates the transport. The reporter has an existing open
  [PR #21048](https://github.com/stablyai/orca/pull/21048), verified at head
  `78b942c468aa32b57051e41d0bcc484617b5cecc`, so this audit does not duplicate it.
  The reported integration measurement belongs to that PR's author; it was not
  rerun here.
- [#18186](https://github.com/stablyai/orca/issues/18186): the reported 1.4.193
  source already registers persistent SIGTERM/SIGINT handlers after headless RPC
  startup. The claim that signal handling was absent is contradicted by that
  release. Signal delivery and the stalled quit step remain unproven.

## Current code follow-ups

- [#12241](https://github.com/stablyai/orca/issues/12241): actual GUI removal and
  Store calls leave 32 seeded host partitions after 32 pair/remove cycles, even
  after disk flush and reload. All environment records are removed and transport
  invalidation runs 32 times. Existing renderer tests pass because they establish
  that future writes stop; they do not delete persisted partitions. Current
  paired-host mirroring uses `session.tabs.listAll`/subscriptions, while the older
  `importRemoteWorkspaceSession` helper remains in the direct SSH path. A safe fix
  still needs to account for late writes and host ownership. This bounded proof
  does not reproduce the historical memory magnitude or the separate #12207 OOM.
- [Four current/reported-source reviews](../runtime-memory-body-issues/README.md)
  cover #11315, #15098, #15882 and #19312. Finite slow fingerprint probes reproduce
  #19312's repeated-scan branch; a silent quota-probe control follows the existing
  timer deadlines. The remaining freeze/CPU attribution limits are explicit.
  Flat RSS or stable renderer heap is not converted into a heap-leak claim.
- #19388 describes retained settled-worker records and explicitly reports that
  manual release did not materially reduce the incident's memory pressure.
  #19342 describes saturation of a fixed long-poll pool. Their retention and
  admission policies require separate analysis from unbounded heap growth.
  The [RPC/worker-record review](../runtime-resource-body-review/README.md)
  reproduces #19342 admission saturation and #19660's ignored local caller
  deadline; the latter already has open PR #19662.
- [#18224's hidden-worktree create path](../hidden-worktree-terminal-create/README.md)
  is reproduced with eight controls across four current/main-boundary Node and
  Electron runs. A successful main worktree scan can supply a launch row that
  renderer visibility policy hides. Timeout retains the tab and command; a late
  catalog arrival or visibility change can still make that command eligible.
  Cleanup based only on timeout would lose valid late launches. The existing
  background guard PR #18290 remains separate from this focused-path review.
- [#15833's generated Codex hook](../codex-hook-stdin-lifetime/README.md) stays
  blocked with a complete JSON payload while the input pipe remains open beyond
  ten seconds, then exits on EOF. Six controls across Node and Electron include
  immediate EOF and the current Grok JSON reader. This confirms a script-level
  liveness mechanism; it does not reproduce Codex's own timeout enforcement or
  establish memory growth.

The [unpairing artifact](../paired-host-partition-retention/README.md) records the
32-partition Store/disk/reload result and four late-writer counterexamples to
deletion alone. Product changes remain under ownership review.

No affected-host diagnostic data is available. The audit continues with code,
bounded actual-source experiments and the evidence already supplied in issues.

The [native/React crash review](../native-and-react-crash-body-review/README.md)
traces #16759, #18186, #18200 and #20517, with 47 crash-focused controls and 43
separate Linux lifetime/signal contract controls passing. The Linux
AppImage report has specific backing-lifetime evidence; the Windows native fault
and macOS React initiating cycle remain unattributed. Scanner child retirement is
an active follow-up, and passing known-loop tests is not incident reproduction.
