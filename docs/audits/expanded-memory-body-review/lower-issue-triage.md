# Expanded memory-body review: new candidates below #11000

Read all 38 complete bodies and all 85 cached comments, with pagination complete. Every body/comment SHA-256 matches the root discovery index. No network requests, attachment execution, or product changes.

## Findings

- **#10859:** reported renderer-growth lead. Current actual full-store replay stays bounded at two rows after each restart/ingest because existing hydration deduplication intervenes. A separate dirty-draft loss control remains current. Historical source comparison is in progress; no pruning fix is proposed.
- **#7783 / #9229:** real surviving daemon/process-generation resource pressure. Existing #9138 lifecycle work must be checked before duplicating it; persistent live sessions require owner/provenance checks.
- **#9585 / #10718:** distinguish persisted ghost rows/history from live reusable agents. Later comments explicitly separate those layers; automatic process killing cannot be justified from Done/sidebar state.
- **#9576:** real GPU/CPU/energy report, with explicit transient-cooling confound and no demonstrated heap growth.
- **#10278:** native GPF/kernel crash report, not evidence of JavaScript heap exhaustion. Reporter causality is unverified.

The other 31 entries are feature requests or non-memory functional bugs. Some request resource placement/visibility or future lifecycle policy; those remain valid product work but do not establish memory leaks.

## Per-issue review

### [#2284](https://github.com/stablyai/orca/issues/2284): feature-context-memory

Custom CLI presets and per-account/per-repo profile support. Memory denotes Claude account conversation/MCP context isolation; all 12 comments concern launch identities, providers, profiles and UI. No process-growth or retained-heap report.

Read body + 12 comments. Exact hashes: `lower-issue-triage.json`.

### [#2814](https://github.com/stablyai/orca/issues/2814): feature-resource-placement

Requests dedicated cloud machines and warm pools to isolate CPU/RAM/disk consumed by parallel agent/build workloads. The sole comment is an architecture/feature plan. Resource contention motivates new execution placement; no measured Orca retention defect is alleged.

Read body + 1 comments. Exact hashes: `lower-issue-triage.json`.

### [#4630](https://github.com/stablyai/orca/issues/4630): non-memory-status-bug

Claude-Mem background PostToolUse/Stop cycles retrigger completion notifications, including a sleeping worktree. Two source repro comments attribute duplicate notifications to turn rearming. Memory is the plugin’s context feature, not observed application heap growth.

Read body + 3 comments. Exact hashes: `lower-issue-triage.json`.

### [#5978](https://github.com/stablyai/orca/issues/5978): feature-lexical

Requests custom sidebar labels; “Memory Experiment” is an example task name. Three comments discuss labels, truncated prompts and tab/sidebar rename mismatch only.

Read body + 3 comments. Exact hashes: `lower-issue-triage.json`.

### [#6874](https://github.com/stablyai/orca/issues/6874): hang-with-low-memory-evidence

Windows WSL/UNC workspace activation causes AppHangB 1/stale_bootstrap. Reporter records renderer usedHeap near 78 MB, zero webviews and substantial free physical memory; daemon about 60 MB. Later Windows activation stress with 87 sessions did not reproduce the hang. Preserve as unresolved Windows liveness issue; no heap-exhaustion inference from this body.

Read body + 2 comments. Exact hashes: `lower-issue-triage.json`.

### [#7783](https://github.com/stablyai/orca/issues/7783): genuine-process-lifetime-resource-report

After GUI/runtime shutdown, daemon-owned live agent/MCP/login trees remain and consume swap; reporter counts 189 descendants and lower swap after manual cleanup. Follow-up confirms 8 daemon generations aged 1–5+days, one with 165 descendants/55 login shells. Needs current shutdown/protocol-generation custody trace; app-not-running alone does not prove sessions should be killed.

Read body + 1 comments. Exact hashes: `lower-issue-triage.json`.

### [#8086](https://github.com/stablyai/orca/issues/8086): feature-resource-placement

Requests resumable local-to-remote execution handoff so agents use remote CPU/RAM/battery. Comments add reconnect reliability and an Agents-tab entry point. No specific memory leak/heap-growth evidence; cannot equate desired handoff with premature local-process termination.

Read body + 3 comments. Exact hashes: `lower-issue-triage.json`.

### [#8261](https://github.com/stablyai/orca/issues/8261): non-memory-update-lifecycle

Explicit updater install trace explains quit/session disruption;87 MB heap is background evidence, not OOM. Latest Windows comment corrects older PTY-kill claim: same daemon and all terminals survive, while main-process orchestration wait loses its connection during 86 s restart. Multi-platform update continuity issue, not retained-memory report.

Read body + 5 comments. Exact hashes: `lower-issue-triage.json`.

### [#8280](https://github.com/stablyai/orca/issues/8280): feature-lexical

Detailed Lark task-provider spec; “muscle memory” refers to consistent UI, “unbounded processes” is a prospective CLI-concurrency requirement. Two comments discuss ownership/plugin integration. No existing allocation/retention incident.

Read body + 2 comments. Exact hashes: `lower-issue-triage.json`.

### [#8702](https://github.com/stablyai/orca/issues/8702): feature-context-memory

Requests nested multi-repo workspace context separate from git worktree isolation. Memory means shared agent context across product repos; no comments or heap/resource incident. Full long model/acceptance body read.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#8736](https://github.com/stablyai/orca/issues/8736): feature-lexical

Double-click tab-strip to create a terminal using current cwd/host; memory is muscle memory. Two comments discuss existing cwd plumbing and macOS titlebar gesture conflicts, not resource growth.

Read body + 2 comments. Exact hashes: `lower-issue-triage.json`.

### [#8927](https://github.com/stablyai/orca/issues/8927): feature-performance-design

iOS redesign proposes recent-first/lazy conversation loading to reduce memory and scrolling lag. No measured process growth, OOM or reproducible retained-object mechanism; broad performance/UX acceptance goal with mockups, no comments.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#9021](https://github.com/stablyai/orca/issues/9021): feature-capacity-policy

Requests more than 3 concurrent worker slots when machine CPU/RAM permits. Explicit capacity-policy feature with no comments or memory-growth incident; not authorization to raise/lower limits in this audit.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#9132](https://github.com/stablyai/orca/issues/9132): non-memory-data-ownership

MiMo MIMOCODE_HOME overlay redirects canonical auth/data/cache/state and causes 401. Memory means persisted agent context hidden by path redirection; no heap growth. Native/WSL/SSH config-only overlay request is distinct from memory retention.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#9222](https://github.com/stablyai/orca/issues/9222): feature-supervised-lifecycle

External-context phase handoff design releases dispatch slots and persists typed responses across disconnects; memory occurs in in-memory test runtime wording. Resource ownership is prospective protocol design, with explicit 256 KiB artifact limit, not an observed retention defect.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#9228](https://github.com/stablyai/orca/issues/9228): non-memory-durability

Poll-driven coordinator and process-local campaign state lose lifecycle progress across restart; comment records 11 missed completion/wakeup incidents. In-memory denotes nondurable state rather than rising heap/RSS. No observed allocation growth.

Read body + 1 comments. Exact hashes: `lower-issue-triage.json`.

### [#9229](https://github.com/stablyai/orca/issues/9229): genuine-process-lifetime-resource-report

Failed Linux headless scope shutdown leaves prior generation at 15.55 GiB/81 processes versus current 1.21 GiB/4 processes, with 19 recent kernel OOMkills and near-full swap. Issue explicitly refuses blind cleanup because surviving PTYs may hold active/unlanded work; linked to 7783/9138. Needs current generation/provenance reconciliation trace, not a generic heap-cap fix.

Read body + 1 comments. Exact hashes: `lower-issue-triage.json`.

### [#9456](https://github.com/stablyai/orca/issues/9456): feature-context-memory

Named Claude config-directory/CLI aliases isolate auth, hooks, MCP and persisted conversation memory between accounts. No comments or memory-usage symptom.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#9576](https://github.com/stablyai/orca/issues/9576): genuine-cpu-gpu-resource-report

Idle macOS GPU/WindowServer power report, with reversible open/quit measurements and later hot/cooled samples. Latest comment reports system RAM 13.34 GB then 11.05 GB but explicitly notes spontaneous cooling before restart, five live agents and no swap. Genuine resource/energy issue; no isolated heap-retention mechanism or proof that restart caused full power reduction.

Read body + 3 comments. Exact hashes: `lower-issue-triage.json`.

### [#9585](https://github.com/stablyai/orca/issues/9585): genuine-stale-state-resource-report

Ghost terminal/sidebar state accumulates across remote restarts. Crucial later comment contradicts original daemon-only diagnosis: zero live PTYs/processes;33 layout/incarnation entries persist in remote singular workspaceSession, not workspaceSessionsByHostId. Deleting 59 MBhistory regenerates 33 directories while runtime restart preserves metadata. Trace owner-side persisted layout cleanup; do not attribute live daemon heap or process leak from stale sidebar rows.

Read body + 2 comments. Exact hashes: `lower-issue-triage.json`.

### [#9644](https://github.com/stablyai/orca/issues/9644): feature-lexical

Equalize split-pane sizes and discoverability; memory is muscle memory. Sole comment links existingPR 10831 for hints and pointer-capture behavior, not resource retention.

Read body + 1 comments. Exact hashes: `lower-issue-triage.json`.

### [#9699](https://github.com/stablyai/orca/issues/9699): feature-lexical

Vim/Emacs keybindings to preserve muscle memory. All five comments read, including large future implementation spec and existingPR 9755 summary. Adapter/listener disposal are acceptance criteria, with no actual leaked-instance or heap-growth report.

Read body + 5 comments. Exact hashes: `lower-issue-triage.json`.

### [#9737](https://github.com/stablyai/orca/issues/9737): feature-in-memory-model

Selection character/word counter UI. In-memory Monaco model describes computation locality; no comments, memory growth or lifetime claim.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#9808](https://github.com/stablyai/orca/issues/9808): feature-resource-observability

Remote health/capability-negotiation proposal includes memoryGB and overload-aware scheduling. No observed memory/resource failure or comments; metadata/health feature, not a measured leak.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#9818](https://github.com/stablyai/orca/issues/9818): feature-lexical

Cross-tab cursor back/forward history with remappable shortcuts. Memory is muscle memory; no comments or retained-history growth report.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#9951](https://github.com/stablyai/orca/issues/9951): feature-process-lifetime-policy

Requests optional one-shot headless dispatch to avoid TUI recognition/paste failures and let agent processes exit between tasks. Memory row compares intended resident-vs-one-shot lifetime; comments discuss permissions, external CLI implementation, stream/session tracking. Real dispatch usability gap, no demonstrated Orca allocation leak; not justification to kill reusable interactive workers.

Read body + 3 comments. Exact hashes: `lower-issue-triage.json`.

### [#10153](https://github.com/stablyai/orca/issues/10153): feature-lexical

Opt-in sidebar placement swap to match muscle memory, with existingPR 10152 and two support comments. No resource report.

Read body + 2 comments. Exact hashes: `lower-issue-triage.json`.

### [#10263](https://github.com/stablyai/orca/issues/10263): feature-bounded-undo

Explorer move confirmation request cites in-memory undo stack capped 50 and cleared on worktree switch because recovery window is too short. Sole comment proposes confirmation policy. Existing bounded retention is not alleged to leak.

Read body + 1 comments. Exact hashes: `lower-issue-triage.json`.

### [#10278](https://github.com/stablyai/orca/issues/10278): genuine-native-crash-report

Linux Docker orca-ide GPF/SIGSEGV restart storm and ext 4/RCU kernel panic. “Memory safety” means invalid native accesses, not heap exhaustion; no RSS/heap-growth evidence. Claimed application-to-kernel corruption causality is reporter inference; comment is environment-blocked. Needs exact binary/symbol/native crash evidence; do not equate deterministic reported offset with JS retention.

Read body + 1 comments. Exact hashes: `lower-issue-triage.json`.

### [#10559](https://github.com/stablyai/orca/issues/10559): feature-oom-cross-reference

Opt-in glab execution on SSH host with version negotiation. OOM appears only in proposed bounded stdout/stderr requirement referencing existing bounding work. No current memory incident or comments.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#10572](https://github.com/stablyai/orca/issues/10572): non-memory-attribution

Sidebar groups an agent under its original pane worktree even when Claude starts in a different worktree. Memory accounting is only a cited alternative use of cwd metadata. Four comments include current confirmation and three attribution PRs; no memory growth or excess process creation.

Read body + 4 comments. Exact hashes: `lower-issue-triage.json`.

### [#10608](https://github.com/stablyai/orca/issues/10608): feature-resource-observability

Requests headless serve occupancy/version/uptime stats; explicitly excludes host CPU/RAM metrics and PTY cleanup. Memory appears in diagnostics.memory API analogy. Three comments point to existing draftPR 10612 and separate resource-health requests.

Read body + 3 comments. Exact hashes: `lower-issue-triage.json`.

### [#10718](https://github.com/stablyai/orca/issues/10718): genuine-process-and-stale-state-resource-report

Two distinct layers:44 connected terminals/~75 grok processes with swap pressure reduce to 6/~9 after manual close; historical Done rows then remain with no backing live PTY. Latest automation repro adds one inert Done row per successful reuseSession run despite no live terminals. Lifecycle/discoverability and persisted ghost-state lead, not proof that every Done row owns a process or heap leak.

Read body + 5 comments. Exact hashes: `lower-issue-triage.json`.

### [#10795](https://github.com/stablyai/orca/issues/10795): non-memory-auth-rollback

Reauthentication timeout destroys live Codex auth state; saved initial credential bytes are in memory but unused for rollback. Memory denotes available snapshot data, not growth; no comments or allocation-lifetime evidence.

Read body + 0 comments. Exact hashes: `lower-issue-triage.json`.

### [#10830](https://github.com/stablyai/orca/issues/10830): feature-context-memory

Requests Jcode integration; agent memory is a listed agent capability. Sole comment points toPR 10521. No application-memory symptom.

Read body + 1 comments. Exact hashes: `lower-issue-triage.json`.

### [#10859](https://github.com/stablyai/orca/issues/10859): genuine-renderer-growth-report

Reported mirrored editor duplication with renderer heap near 3.47 GB and exit 5; full 10 comment correction chain read. Executed author controls withdraw cross-machine amplification: +1 uncullable row per restart/hydrate with constant one-tab wire input, no growth without restart. Hydrate changes ids and persistence strips mirror flag. Both simple flag persistence and path-based culling fixes were withdrawn after dropping dirty drafts. Current safe reconciliation requires proof and draft/ownership preservation; later comments add stale worktree-id and ghost sleeping-session variants.

Read body + 10 comments. Exact hashes: `lower-issue-triage.json`.

### [#10923](https://github.com/stablyai/orca/issues/10923): non-memory-identity-propagation

Mobile chat empty despite existing transcript/status because provider-session identity is omitted or reset; full 5 comments broaden headlessClaude to desktopCodex/OMP and expose OMP callback reset. In-memory describes status cache, not heap growth; tiny transcript control fails too.

Read body + 5 comments. Exact hashes: `lower-issue-triage.json`.

### [#10999](https://github.com/stablyai/orca/issues/10999): non-memory-completion-attribution

Nested claude -p shares pane key and prematurely completes automation, which kills still-working primary agent. Body explicitly rules out OOM/crash, and notes plugin-disable workaround also changed prompt timing. Three comments link existingPR 11158 and exact provider-session receipt work. Memory query matched explicit negative OOM statement, not memory evidence.

Read body + 3 comments. Exact hashes: `lower-issue-triage.json`.

## Current #10859 follow-up

Four bounded actual full-store controls pass in Node26.6 and Electron43.7/Node24.21. Constant one-tab input gives rows[1,2,2,2,2,2,2,2] with restarts and[1,1,1,1,1,1,1,1] without. Current hydration deduplicates restored owner/id; historical reported source investigation remains in progress. Draft correctness risk also reproduced: fresh visible duplicate draft persists but is skipped behind an older clean row during next hydration. No pruning proposal or product edit.
