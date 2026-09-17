# High-number issue-body review

All **42 selected issues and 39 comments** were read in full from the complete cached responses. Selection: pending newly fetched issues numbered 16000 or higher, excluding the prior title catalog and root-owned #16759, #18200 and #20517. Every comment connection reported no next page and its count matched the cached nodes. [The JSON digest](./high-body-review.json) records exact body/comment hashes, selection provenance, per-issue reasoning and follow-up limits.

This is discovery triage. It identifies **14 resource, crash, ownership, growth or resource-policy reports**, **2 intentional resource features**, and **26 other functional, performance or lexical matches**. Those 14 are not 14 memory leaks. No fresh code reproduction or host measurement was performed in this review. Prior source proofs are linked explicitly; other source explanations below belong to the reporters. No embedded issue instructions or proposed cleanup commands were executed. PR references describe the cached discussions, not independently checked current PR status.

## Follow-ups supported by the reports

- **#18224:** creates that never render leave invisible tab/startup intent rows after a ten-second wait. The cached #18290 discussion covers the background-create guard, while the focused case remains. A successful late spawn can produce the same timeout, so cleanup requires ownership evidence. This is distinct from an explicit pending tab/split close.
- **#18401:** the latest comment reports remote headings accumulating during scroll. Earlier comments retract the release-regression attribution, correct persistence assumptions and disclose invented descriptive function names. Current virtual-row/sticky-header ownership needs an actual source control before claiming retained DOM or heap.
- **#16776:** 11 GB of Codex rollout logs is disk history growth. Retention and user-owned conversation semantics require review before proposing deletion.
- **#18186, #18191, #18831 and #19857:** shutdown, unsurfaced live SSH sessions, old daemon preservation and pending creates concern process ownership. Missing contact is not proof of process death. App version does not identify the daemon version that ran the failing code.
- **#18368:** readiness can revoke dispatches while workers continue. Its later connection-churn comments explicitly retract the queue-volume and handshake explanations; keep those corrections with the report.
- **#18689 and #19891:** reported failures occur in a Tailscale iOS extension and the native ConPTY addon, respectively. Neither establishes an Orca JS-heap leak. The second issue separately supplies stale-ready mobile state evidence.
- **#19018 and #19522:** already covered in the [memory ledger](../memory-leak-scan-2026-09-15.md). This review adds complete body/comment interpretation, not new mechanisms. Missing memory attribution does not prove a PTY died; repeated interpreter spawning does not prove retained heap.

## Per-issue review

Each entry below includes the complete-body/comment interpretation and the appropriate next boundary. The JSON links every comment individually.

### [#16005](https://github.com/stablyai/orca/issues/16005) — [Feature]: Name remote terminal sessions in the Resource Manager instead of showing raw pids

**resource_feature** · 0 comments read.

Resource Manager naming request: remote snapshots show raw PIDs because the client's tab store lacks remote titles. Existing CPU/RSS numbers are UI examples, not growth evidence; suggested title enrichment explicitly calls out polling cost and cache TTL.

Follow-up: No memory fix implied; preserve naming-only scope and live/unverifiable/exited remote authority.

### [#16008](https://github.com/stablyai/orca/issues/16008) — [Feature]: Preload the local speech model so the first dictation does not wait ~2.3 s

**resource_feature** · 0 comments read.

Speech startup latency proposal explicitly trades about 1.2 GB of retained model RSS for a warm recognizer. Report measures roughly 2.3 seconds of ONNX session construction and a one-hour idle teardown; it asks for opt-in preload/keep-warm, not relief from an accidental leak.

Follow-up: Relate to existing speech-worker accounting audit as intentional model residency, not proof of the audio-queue mechanism.

Existing audit: [speech-worker-audio-budget](../speech-worker-audio-budget/README.md).

### [#16086](https://github.com/stablyai/orca/issues/16086) — [Bug]: Mobile pairing URL advertises an E2EE public key that differs from the WS listener's key — Linux headless serve (1.4.188), all pairings fail 4001

**non_memory_correctness** · 0 comments read.

Pairing URL key differs from the persisted key used by the listener; the reporter's handshake succeeds with the persisted key. In-memory keypair is a state-authority reference, with no growing allocation or process-retention measurement.

Follow-up: Authentication/bootstrap key consistency; proposed process-chain cause remains reporter inference.

### [#16464](https://github.com/stablyai/orca/issues/16464) — [Feature]: bindable keybinding action to move a tab to a new pane column

**feature_lexical** · 0 comments read.

Requests a bindable action to move the active tab into a pane column. The memory match is muscle memory for a shortcut, not resource usage.

Follow-up: No memory-audit code follow-up.

### [#16629](https://github.com/stablyai/orca/issues/16629) — [Bug]: [AV False Positive] PowerShell OSC 133 integration triggers 'PowerShell/Bypass.K' EDR flag

**non_memory_correctness** · 0 comments read.

PowerShell EncodedCommand shell integration triggers an EDR heuristic. Execution in memory describes the antivirus concern; no resource growth or exhaustion is reported.

Follow-up: Security/launch compatibility, separate from OSC parser retained-parent memory fixes.

### [#16776](https://github.com/stablyai/orca/issues/16776) — codex-runtime-home/sessions grows unbounded, consumed 11GB with no cleanup mechanism

**disk_growth** · 0 comments read.

Reports 11 GB of Codex rollout JSONL history, over 1000 files, inside a 15 GB app-data footprint. Claims no TTL/cap/cleanup UI; this is persistent disk accumulation, not a reported JS-heap or RSS leak.

Follow-up: Review existing Codex session-history ownership and retention policy before any deletion proposal; do not apply the reporter's destructive cleanup command automatically.

### [#16790](https://github.com/stablyai/orca/issues/16790) — [Feature]: Add configurable command palette shortcut (F1)

**feature_lexical** · 0 comments read.

Requests configurable Monaco command-palette shortcuts across editors/diffs/notebooks. Memory means familiar shortcut muscle memory; proposed listener disposal tests are feature implementation detail, not a reported leak.

Follow-up: No new memory mechanism.

### [#16910](https://github.com/stablyai/orca/issues/16910) — [Feature] Orca feature request more like an assistant/ Orca Bot mode

**feature_lexical** · 5 comments read.

Body and all five comments propose persistent bots, connected apps, provider-independent long-term memory, and orchestration UI. Memory means stored preferences/history/identity, not RAM; final comment only reports a CLI bot integration.

Follow-up: No memory/resource incident or measured leak.

### [#17114](https://github.com/stablyai/orca/issues/17114) — Log-cap rotation replaces durable scrollback with the live window

**resource_bound_correctness** · 0 comments read.

Reports that normal log-cap rotation replaces deep durable scrollback with a shorter live snapshot, losing history (638 shrinking rotations, 1936 MB cumulatively discarded). The issue concerns correct behavior of an existing bound, not growing RAM. Suggested safeguards distinguish actual overflow, disk checkpoint depth, user-cleared history, and once-per-generation refusal.

Follow-up: Link existing terminal-history/checkpoint audit; do not increase memory limits or accept infinite rotation refusal as a fix.

### [#17117](https://github.com/stablyai/orca/issues/17117) — Visible terminal initialization needs an incarnation-aware Runtime identity proof

**non_memory_correctness** · 2 comments read.

Requests an incarnation-aware Runtime identity proof for visible terminals after restart/reconnect. In-memory bounded challenge state is a design requirement, not observed retention. Both comments are acknowledgement/community contact, with no memory evidence.

Follow-up: Terminal identity/authority feature; no memory attribution.

### [#17307](https://github.com/stablyai/orca/issues/17307) — [Bug]: worker-start validates a reused terminal against a stale leaf.worktreeId, missing PTY-reincarnation drift

**non_memory_correctness** · 1 comments read.

Reports reused-terminal worktree validation reading stale leaf metadata after PTY reincarnation. Comment reproduces the source mismatch and links PR18042 with freshWorktreeId and older-host fallback. The in-memory map is a correctness authority, not a measured growth owner.

Follow-up: Existing PR18042 reported in cached comment; do not claim its current merge status without verification.

### [#17435](https://github.com/stablyai/orca/issues/17435) — Onboarding can report GitHub CLI unavailable after runtime GitHub commands succeed

**non_memory_correctness** · 1 comments read.

Onboarding caches a negative GitHub capability result while runtime operations succeed. Original Linux report expressly does not establish PATH or initial probe cause; later macOS/MacPorts comment separately demonstrates GUI PATH excluding /opt/local/bin. Preserve that platform-specific correction; no cache-cardinality or memory-growth evidence.

Follow-up: Capability resolver/state invalidation, not cache eviction or heap attribution.

### [#17645](https://github.com/stablyai/orca/issues/17645) — [Bug]: On a primary-checkout row, "Remove Project from Orca" occupies the "Delete" slot and its confirmation understates the blast radius

**non_memory_correctness** · 0 comments read.

Project removal occupies the row-delete menu slot and hides all worktrees; reporter confirms checkouts/branches/commits remained on disk. Memory is menu muscle memory. Re-add identity/metadata loss and visibility defaults are UX/persistence issues, not growth.

Follow-up: Do not infer destructive filesystem deletion or memory leakage from disappearing UI rows.

### [#17864](https://github.com/stablyai/orca/issues/17864) — [Feature]: task-update has no terminal status for 'dispatched, outcome never recorded' (abandoned/cancelled)

**feature_lexical** · 0 comments read.

Requests an honest abandoned/cancelled orchestration outcome for revoked dispatches whose work is unverifiable. Coordinator memory means conversational context after restart. Incorrect durable task statuses are not a resource leak measurement.

Follow-up: State vocabulary/authority; do not equate missing outcome with process death.

### [#18186](https://github.com/stablyai/orca/issues/18186) — [Bug][Linux/headless]: `orca serve` ignores SIGTERM — systemd stop always ends in SIGKILL of the whole cgroup, and needrestart/unattended-upgrades trigger it unattended (v1.4.193)

**process_lifecycle** · 1 comments read.

Reports headless SIGTERM ignored for 90 seconds, systemd escalation to whole-cgroup SIGKILL, killed agents, and leftover Xvfb/orca processes during two needrestart-triggered service restarts. Explicitly reports idle load, 14% RAM and no OOM; resource ownership/shutdown is real, but OOM wording is adjacent policy discussion.

Follow-up: Source follow-up on graceful serve shutdown and remaining children; relate to existing headless crash/daemon survivability work without claiming RAM exhaustion caused this incident.

### [#18191](https://github.com/stablyai/orca/issues/18191) — [Bug]: CLI-created terminals on the SSH relay lose their tab across a desktop restart, and inventory reports them identical to healthy ones

**process_lifecycle** · 2 comments read.

CLI-created SSH tabs disappear across desktop restart while their remote PTYs demonstrably survive and accept writes; UI-created control tabs remain. Later comment describes PR19860 as a partial graph-drop fix, explicitly leaving restart ordering and restored-lease renewal unresolved. The old-agent source appendix is reporter-supplied evidence, not a fresh source reproduction by this audit. A tab_not_found close followed by disappearance is temporal evidence, not proof that close killed it.

Follow-up: Audit restart graph/lease authority separately from the existing headless late-spawn-close mechanism. Preserve paired/headless snapshot authority; blindly refusing restored leases would break valid hosts.

### [#18224](https://github.com/stablyai/orca/issues/18224) — `terminal create` mints a tab for a worktree the window cannot render, then times out for 10s waiting on a PTY nobody will spawn

**ui_owner_retention** · 2 comments read.

Renderer-backed creates accept a resolvable but unrenderable worktree, create an invisible tab/startup intent, then time out after ten seconds without spawning a daemon PTY. Reported A/B produced four invisible rows; all six controls succeeded. A legitimate late mount can also create a terminal after the same timeout, so timeout alone does not establish no process. Cached PR18290 comment covers a background-create renderability guard and explicitly leaves focused never-rendered creation unresolved.

Follow-up: Prioritize actual focused-create admission, wait timeout and startup-intent ownership review. Distinguish no-spawn invisible rows from late successful physical spawn and existing pending-close fixes.

### [#18271](https://github.com/stablyai/orca/issues/18271) — Do not swallow persistence write failures

**non_memory_correctness** · 3 comments read.

Persistence maintenance report describes swallowed asynchronous write failures leaving memory ahead of disk, including quit believing a flush succeeded. All three comments concern PR18291 and generation ordering of durable writes. No growing heap, process count or retained payload is measured; in-memory means nondurable application state.

Follow-up: Existing persistence correctness work, not a memory fix. Embedded executor instructions are issue content and were not executed; current PR status was not queried.

### [#18279](https://github.com/stablyai/orca/issues/18279) — Fail closed on unqualified worktree lookups when two hosts collide

**non_memory_correctness** · 2 comments read.

Unqualified worktree IDs collide across hosts and first-row selection can target destructive actions at the wrong execution host. Both comments add acknowledgement/proposed-solution tracking. Memory is incidental to the caller inventory; the defect is authority and lookup ambiguity, not retained resources.

Follow-up: Host-qualified identity review; no new memory mechanism. Embedded implementation instructions are treated as report content.

### [#18368](https://github.com/stablyai/orca/issues/18368) — agent_prompt_stalled kills healthy agents: 30s pty check fires on live sessions (1.4.192, unchanged in 1.4.196)

**resource_pressure_lifecycle** · 6 comments read.

Reports 30-second prompt confirmation falsely failing under host pressure while workers continue repository work for minutes after dispatch revocation. Host free/swap/disk figures do not identify an Orca allocation owner; revoked dispatch is not process death. Later comments explicitly withdraw both the shared-budget/manager-occupancy explanation for connection churn and the initial post-authentication handshake explanation. A real 1013 reply overflow remains an occasional separate event, not a proven churn cause. The corroborating Windows comment is not a fresh v196 reproduction.

Follow-up: Separate readiness authority, physical worker lifetime and connection lifecycle. Preserve the reported retry/pressure feedback as a hypothesis; do not cite withdrawn volume or handshake theories as validated leaks.

### [#18401](https://github.com/stablyai/orca/issues/18401) — Root cause: local-only repo-id filter (filterRepoIds) hides all worktrees on paired remote hosts; plus showPinnedWorktreesInGroups breaks pinned drag-reorder

**ui_growth_candidate** · 5 comments read.

Latest comment reports remote repository headings accumulating during scrolling, but provides no heap, DOM-count or source reproduction. Earlier remote-visibility failure was a local-only filter and drag failure a pinned-group option; rollback disproved the original v196 regression claim. Reporter then corrected an erroneous claim that remote tabs were not persisted, corrected a no-discriminator claim, and disclosed that earlier function names were invented descriptive labels. Exact duplicate counts and recycling/append cause remain unproven.

Follow-up: Bounded current sticky-header/virtual-row lifecycle control is worthwhile. Scope to the latest observable accumulation; do not reuse retracted version, persistence or invented-symbol claims.

### [#18483](https://github.com/stablyai/orca/issues/18483) — [Bug][Windows] Updater requires closing Orca but update cannot proceed once closed (deadlock)

**non_memory_correctness** · 0 comments read.

Windows updater requires app closure but installation does not proceed after closing. Diagnostics memory is only an offered diagnostic; no memory pressure, allocation growth or lingering-process measurement appears in the report.

Follow-up: Updater lifecycle correctness; no memory-audit mechanism established.

### [#18689](https://github.com/stablyai/orca/issues/18689) — [Bug]: Orca Mobile over Tailscale disconnects on initial agent prompt / drops iOS NetworkExtension

**external_process_resource** · 0 comments read.

Reports Tailscale's iOS NetworkExtension being jetsammed during terminal output bursts on v190, then a remaining WebSocket heartbeat loss on v197 while full VPN loss is mitigated. The killed process is the VPN extension, not Orca's renderer or main process. Packet-buffer accumulation, MTU effects and claimed extension limits are reporter explanations, not independently verified by this body review.

Follow-up: Review existing mobile output/backpressure and heartbeat ownership before attributing the external jetsam. Keep v190 extension death distinct from v197 socket timeout and endpoint-selection behavior.

### [#18831](https://github.com/stablyai/orca/issues/18831) — Session daemon never auto-updates for users with live terminals — silent, unbounded version drift (daemon 1.4.190 vs app 1.4.197)

**process_lifecycle** · 0 comments read.

A v190 daemon remains active for eight days under a v197 app because replacement preserves live or unverifiable sessions. Unbounded refers to version drift, not allocation growth. Twenty-one live terminals intentionally prevent destructive replacement; the report asks for visibility and a nondestructive update path.

Follow-up: Track exact daemon version when mapping memory fixes to incidents. Do not remove live/unverifiable preservation or interpret idle sessions as safely dead.

### [#18855](https://github.com/stablyai/orca/issues/18855) — [Bug]: Windows sign-in follow-ups: cancellation reported as ENOENT, Codex loopback ends on ERR_CONNECTION_REFUSED, child-process timeouts too tight under endpoint security

**non_memory_correctness** · 0 comments read.

Windows sign-in cancellation is surfaced as ENOENT; a successful Codex login ends on a misleading loopback error; endpoint inspection delays child startup and triggers memory-enumeration/daemon timeouts. The memory log is a process-enumeration timeout, not measured memory exhaustion. Reporter distinguishes successful credential capture and Store alias EACCES from executable absence.

Follow-up: Timeout and platform/authentication correctness; no retained-memory owner shown. Preserve daemon fallback's loss of terminal survivability as a separate consequence.

### [#19018](https://github.com/stablyai/orca/issues/19018) — terminal_pane_owner_conflict: dead PTYs stay connected:true and can never be closed (local Windows host)

**stale_terminal_registry** · 1 comments read.

Reports rising connected registry entries, duplicate pane owners and stop_unverified on Windows. Already covered by the memory ledger's actual delayed-exit, queued-graph and stop-verification proofs. Missing diagnostics.memory attribution alone does not prove a process is dead; the reporter's phantom terminology and automatic cleanup comment cannot replace authoritative owning-host exit evidence.

Follow-up: Reuse ML028/ML035/ML037/ML039 and existing exact-owner/endpoint proofs; do not count as a new discovery or claim the issue's exact event ordering is established.

Existing audit: [memory-leak-scan-2026-09-15](../memory-leak-scan-2026-09-15.md), [daemon-late-exit](../daemon-late-exit/README.md), [queued-terminal-graph-exit](../queued-terminal-graph-exit/README.md), [terminal-close-observed-exit](../terminal-close-observed-exit/README.md).

### [#19066](https://github.com/stablyai/orca/issues/19066) — [Other]: Creator Micro 2 community plugin — review and distribution path

**feature_lexical** · 0 comments read.

Requests review/distribution of a hardware-controller community plugin. A CPU/memory advisory above six agents is a feature description; the separate HID child and loopback configurator are disclosed architecture, with no measured leak or abandoned child report.

Follow-up: Community plugin distribution/lifecycle feedback, not a memory incident.

### [#19169](https://github.com/stablyai/orca/issues/19169) — [Bug]: Drag-selecting text is choppy in a terminal running Claude Code (macOS); smooth in iTerm2

**performance_nonmemory** · 0 comments read.

Reports choppy terminal drag selection, worse during redraws and long scrollback, with iTerm2 as a control. Diagnostics memory is offered but no heap, RSS, allocation or collection growth is reported. Large scrollback can increase rendering work without establishing retained-memory leakage.

Follow-up: Selection/redraw performance investigation; do not equate UI lag with OOM.

### [#19173](https://github.com/stablyai/orca/issues/19173) — [Bug]: Runtime-owned SSH workspace has no PTY provider after desktop/host restart

**non_memory_correctness** · 1 comments read.

Persisted runtime-owned SSH workspace says running after restart while process-local PTY provider registration is absent; sandbox remains reachable. Reporter offers a readiness/resume lifecycle hypothesis and explicitly does not establish the complete cause. The Mac/Orbstack comment reports similar symptoms without proving identity of mechanism. In-memory describes a registry that naturally disappears on restart, not growth.

Follow-up: Runtime-owned provider restoration and readiness authority, separate from cache retention.

### [#19333](https://github.com/stablyai/orca/issues/19333) — [Bug]: Windows — agent terminal panes need ~2.3-2.5 s to first paint while shell panes need ~0.5 s (agent's own floor is 720 ms on a bare conpty)

**performance_nonmemory** · 1 comments read.

Corrected report isolates slow agent first paint, retracting the original generic pane-creation explanation because shell panes are fast. It measures component timings and a remaining roughly one-second gap; history size, injected environment and frame-processing throughput controls did not explain it. Renderer_memory appears only as existing telemetry; no heap-growth claim survives the corrected report. CPR timing establishes terminal byte processing, not necessarily physical screen presentation.

Follow-up: Agent startup instrumentation/performance; preserve the reporter's corrected scope and distinguish a terminal response from a displayed frame.

### [#19522](https://github.com/stablyai/orca/issues/19522) — [Bug]: Windows — the relocated daemon host copies only node-pty, so every process-table read falls back to the PowerShell CIM scan (35 powershell.exe/min on v1.4.197)

**native_process_churn** · 2 comments read.

Already-cataloged Windows relocation manifest omits native modules and repeatedly falls back to PowerShell process-table scans. Report measures 35 spawns/minute and removal after copying the addon; later v199 comments add execution-policy event-log flooding and laptop CPU/power cost. These are process/CPU/disk resources, not a retained JS-heap measurement. Reporter explicitly leaves registry PATH behavior, arm64, packaging and consumer identity unproven; reboot/session/browser changes confound the total power delta.

Follow-up: Link the existing #16905/#19522/#17033 ledger row and cited PR17115 without asserting its current status. Preserve missing windows-native-registry JS-entry-point coverage as the distinct packaging caveat.

Existing audit: [memory-leak-scan-2026-09-15](../memory-leak-scan-2026-09-15.md).

### [#19582](https://github.com/stablyai/orca/issues/19582) — orca-serve: terminal tab rename does not survive browser reload

**non_memory_correctness** · 1 comments read.

Manual terminal customTitle persists but is lost in host projection, hydration and renderer mirror across reload. In-memory desktop rename is a state durability comparison, not a retained allocation. Comment is acknowledgement; proposed optional wire field is a reporter patch, not a memory result.

Follow-up: Title persistence/projection correctness, separate from retained title-string memory fixes.

### [#19737](https://github.com/stablyai/orca/issues/19737) — [Bug]: Valid worker_done is rejected while worker-start is still confirming readiness

**non_memory_correctness** · 0 comments read.

Valid worker_done during readiness is rejected as inactive_dispatch. Reporter supplies a deterministic database-state regression and explains that a missing WSL Pi extension enlarged the timing window but is not the state-guard cause. In-memory database means a test fixture; no process or heap growth is measured.

Follow-up: Readiness/completion settlement ordering and late receipts; no memory fix inferred.

### [#19738](https://github.com/stablyai/orca/issues/19738) — [Bug]: worker-stop returns dispatch_inactive when terminal exit precedes the close receipt

**non_memory_correctness** · 0 comments read.

Actual worker exit before stop receipt changes dispatch state so worker-stop incorrectly reports dispatch_inactive. The report explicitly warns that synthetic onPtyExit(-1) is not physical exit proof and rejects an incomplete fix. In-memory database is deterministic test setup, not a memory incident.

Follow-up: Stop-settlement ordering with authoritative exit evidence; do not infer death from synthetic callbacks.

### [#19857](https://github.com/stablyai/orca/issues/19857) — Terminals stop binding on 1.4.199: daemon createOrAttach times out, new tabs render blank and swallow input

**process_lifecycle** · 1 comments read.

createOrAttach remains pending until 30-second timeout; existing sessions keep running while new panes stay blank and repeated remounts occur. A comment identifies the reused daemon as v192 despite app v199 and a separate old v34 daemon with seven children. Restarting daemons restores creation but destroys sessions; no heap measurement identifies the wedge. App version alone cannot attribute this to v199 daemon code.

Follow-up: Trace actual daemon admission/pending creation and old-version compatibility without killing sessions. Distinguish create wedge, retained old daemon and stale retry identity; existing spawn-input retention fixes do not by themselves prove this hang.

### [#19891](https://github.com/stablyai/orca/issues/19891) — [Bug][Windows]: v1.4.199 conpty.node crash leaves Mobile chat falsely ready and unable to send

**native_crash_and_stale_ready** · 0 comments read.

Reports a minidump-confirmed conpty.node access violation and independently reproduced mobile ready state for a disconnected/unwritable terminal. A second predecessor death has no matching dump; replacement start is not death time. Invalid-pointer native failure is not evidence of OOM. Exact native cause and proposed renderer-leaf projection route are not established by this body-only review; recovery did not prove end-to-end mobile send or sustained reliability.

Follow-up: Keep native fault investigation separate from authoritative stale-ready projection and activation recovery. Link existing queued-graph/exit authority work as related, not proof of this native incident.

Existing audit: [queued-terminal-graph-exit](../queued-terminal-graph-exit/README.md).

### [#20083](https://github.com/stablyai/orca/issues/20083) — All terminal sessions of an active project killed at once (session-killed immediate) without user action

**process_lifecycle** · 0 comments read.

Logs show multiple immediate session-killed events carrying one clientId while daemon stays alive; reporter denies user action and supplies low renderer heap/no OS-pressure records. This is unexpected termination, not growing memory. A daemon clientId identifies the requesting client connection, not by itself the exact renderer callback or GUI code path; nearby git refresh is temporal correlation.

Follow-up: Trace explicit immediate-kill callers and project-view ownership without accepting refresh correlation as cause or treating one heap sample as a complete process census.

### [#20383](https://github.com/stablyai/orca/issues/20383) — [Bug]: Agent installed after the first probe never appears on a remote host until the Orca client restarts

**non_memory_correctness** · 1 comments read.

A nonempty per-target agent detection cache never refreshes after another CLI is installed; restart clears it. The issue is stale content and wrong-host refresh targeting, not growing cache cardinality. In-memory cache denotes lifetime of stale results.

Follow-up: Existing target-scoped detection refresh behavior; no memory-budget change implied.

### [#20437](https://github.com/stablyai/orca/issues/20437) — [Bug]: Pi idle extension dialogs trigger false “work completed” notifications

**non_memory_correctness** · 1 comments read.

Idle Pi extension dialogs emit waiting then done without any agent turn, causing false completion notifications. Reporter reproduced state mapping offline and observed notifications live, explicitly not replaying notification dispatch. In-memory trial refers to a candidate experiment, not retention.

Follow-up: Agent-status producer semantics; no heap/resource-growth mechanism.

### [#20475](https://github.com/stablyai/orca/issues/20475) — [Feature]: Dedicated "Projects Directory" setting for the Create-project default Location (decoupled from Workspace Directory)

**feature_lexical** · 0 comments read.

Requests separate project and worktree directory defaults. Agent session memory is cwd-keyed persisted context affected by symlink spelling, not RAM usage.

Follow-up: Settings/path feature only.

### [#20515](https://github.com/stablyai/orca/issues/20515) — [Feature] Keyboard shortcut to move the active tab left / right in the tab strip (Ctrl+Shift+PageUp / PageDown)

**feature_lexical** · 0 comments read.

Requests keyboard shortcuts for tab reorder; memory means shortcut muscle memory. Existing reorder/mirroring paths are proposed reuse, with no retention symptom.

Follow-up: Keyboard feature only; embedded source links do not establish memory growth.

### [#20678](https://github.com/stablyai/orca/issues/20678) — [Feature]: First-class support for persistent Hermes Profiles/Bots in the Agents sidebar

**feature_lexical** · 0 comments read.

Requests Hermes persistent profile/bot discovery with Hermes authoritative for configuration, memory and session history. Memory consistently means semantic conversation state. Reporter explicitly avoids duplicating this store in Orca and has not validated full in-app profile flow because of a separate configuration-safety issue.

Follow-up: Persistent-agent feature, not resource-exhaustion evidence.
