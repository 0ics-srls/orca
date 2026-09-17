# Native and React crash reports found by body search

All four bodies and their five comments were read from the complete cached GitHub responses. These reports describe different failure classes. None establishes a JavaScript heap leak by itself. `review.json` records body/comment hashes, selected source hashes, named release comparisons and the current control runs.

## #16759: Windows access violation near terminal WebGL activity

[#16759](https://github.com/stablyai/orca/issues/16759) reports four renderer access violations (`0xC0000005`) across 1.4.184, 1.4.188 and 1.4.190. The captured fault is an unsymbolized offset in `Orca.exe`; terminal WebGL breadcrumbs precede the deaths by 3.7–70.9 seconds. Those breadcrumbs identify a candidate area, not a native retaining path or faulting function. Heap samples of 70–151 MB are 27–56 seconds old, so they neither demonstrate exhaustion nor exclude a later transient allocation.

The existing WebGL retry fix [#16338](https://github.com/stablyai/orca/pull/16338), commit `81f89a705c5bf334b7ce1086db62fbeafccf1d47`, is not an ancestor of the reported `v1.4.190`. Current reveal/reattach code consults a three-loss/60-second policy before retrying a disabled context. That supplies a relevant later guard; it does not establish that retry churn caused the reported access violations. The current policy tests pass. No packaged native crash or dump symbolication was reproduced in this audit.

## #18200: executable mappings outlive an AppImage mount

[#18200](https://github.com/stablyai/orca/issues/18200) contains unusually specific field evidence: instruction-fetch SIGBUS, fault address equal to the program counter, a file-backed executable mapping, and mount teardown immediately before helper crashes. The [later daemon report](https://github.com/stablyai/orca/issues/18200#issuecomment-5680692169) extends this beyond quit: a daemon reportedly served for 33 hours after its mount disappeared, then faulted while serving. These are reporter measurements, not a local Linux reproduction. Reported ample free memory and this native signature make an AppImage backing-lifetime failure the supported explanation in this thread; they do not explain #19831's OOM.

Current source is compatible with that lifetime mismatch. `daemon-host-relocation.ts` only relocates packaged Windows hosts. On Linux, the launcher uses the normal app entry and default executable; it detaches/unrefs the daemon after readiness. Normal application quit deliberately disconnects from that daemon so live terminals survive. No Linux daemon copy is selected by this launch path.

The AI Vault scanner supplies a separate shutdown gap worth testing: its production singleton exposes no quit drain, and the child performs asynchronous lane/cache cleanup after parent IPC disconnect. Even its explicit client disposal returns `void`; retirement sends shutdown, schedules an unrefed two-second kill timer and unrefs the child without awaiting exit. The normal quit barrier does await watcher teardown and several other owners, so this is not a claim that all child shutdown is unjoined. An AppImage mount can also be killed by service-manager grouping independently of application cleanup; waiting for one helper cannot solve every form of this report.

The existing CLI extracted-payload facility is a potential reusable runtime source, but its extraction and pruning ownership must be reviewed before reusing it for a live daemon. Exiting a daemon merely because its mount disappeared could destroy live work; no such exit policy or process kill was added. The reported extracted-build restart result belongs to the commenter and was not rerun here.

## #18186: service stop timeout despite existing signal handlers

[#18186](https://github.com/stablyai/orca/issues/18186) reports two 90-second systemd stop timeouts followed by cgroup SIGKILL, lost agents, and leftover processes on Linux 1.4.193. The body explicitly reports no OOM event and 14% RAM use. Its conclusion that graceful SIGTERM handling was absent conflicts with the named release source: `v1.4.193` (`898022d7fd8e0ff4a708de1673f54d71d3999f86`) already calls `registerServeSignalHandlers(process, () => app.quit())` in `src/main/index.ts:3443`. The release helper installs persistent SIGINT and SIGTERM listeners. Registration follows successful headless RPC startup; it is not an unconditional early-startup signal handler.

That release also has the two-pass `will-quit` barrier and teardown deadline. Handler presence does not prove which process received the service-manager signal, that the event loop could deliver it, or that quit reached and completed the barrier. The reported service entry invokes the AppImage directly. The current CLI supervisor's forwarding tests therefore cannot by themselves establish the reported AppImage process chain. The later SIGHUP addition is a separate change, not evidence that SIGTERM was previously missing.

Current signal, daemon relocation, and headless shutdown harness contract suites pass **43 tests**. These use controlled signal emitters, packaging fixtures and script/workflow assertions; this audit did not run the Linux AppImage, FUSE or systemd matrix. The source correction rules out a simple missing-SIGTERM-handler explanation. Signal delivery and the exact stalled quit step remain unproven, and this service shutdown report does not explain #19831's OOM.

## #20517: React update-depth errors and separate diagnostics

[#20517](https://github.com/stablyai/orca/issues/20517) records five retained React update-depth reports on 1.4.199/200. Their boundary attribution is explicitly unreliable. Current terminal parking setters already compare set contents, and the earlier paired-activity fix [#13508](https://github.com/stablyai/orca/pull/13508), commit `ec7e3ea47742ba10aa4e176d6271dc99d00ac345`, is an ancestor of 1.4.199. Reapplying a simple equality guard does not explain this report.

Three current React regression suites pass under their controlled watcher/store/visibility inputs. They cover known loops; they do not recreate the packaged report's unidentified initiating interaction. The body reports heap samples of 116–166 MB, taken 26–57 seconds before failure. Those samples do not prove a V8 OOM or identify the updater that exhausted React's root-wide limit.

Two diagnostic details do have direct current-code explanations. The report store intentionally retains five reports. The process-gone predicate suppresses `killed`/exit-15 even when expected teardown is `none`, matching the separate unreported renderer termination described in the body. Neither policy explains the React loop. Eighteen Crashpad helper failures are not eighteen renderer deaths; the helper lifetime work in [#21128](https://github.com/stablyai/orca/pull/21128) does not establish their native fault cause.

## Validation and remaining work

The five crash-focused suites pass **47 tests**: WebGL context recovery, three terminal React-loop controls, and process-gone classification. The four separate Linux lifetime/signal contract suites pass **43 tests**. The exact commands and source identities are recorded in `review.json`. They run without showing an app window. No new product code or incident-matching native reproduction is claimed.

The [scanner custody proof](../scanner-shutdown-custody/README.md) adds four controls in each runtime: disposal returns before physical exit, graceful exit clears the timer, and two disposal timing cases leave invalidation pending. The latter are latent races relevant to a future quit drain, since production currently calls disposal only from its test reset. No scanner product fix or native mount reproduction was added before the user-requested pause. The Windows native fault and macOS React initiating cycle remain unattributed.
