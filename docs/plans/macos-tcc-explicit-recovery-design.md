# STA-7948: macOS daemon folder-access mismatch — finalized plan

Status: finalized 2026-09-21 after live evidence on a production adopted daemon. Supersedes the
2026-09-14 helper-first design (kept below as Layer B, now evidence-gated). No production code yet.
Evidence: [validation/README.md](validation/README.md) (section "2026-09-21 live evidence").

## 1. What is settled

1. **macOS TCC lets `access(2)` and `stat` succeed on Documents/Desktop/Downloads while
   `opendir`/`readdir` fails with EPERM.** Measured in a grant-less launchd process on
   `~/Documents`: `access(R_OK|X_OK)=True`, `stat=ok`, `scandir=EPERM`. Full Disk Access folders
   behave differently (`access()` is denied too). Consequence: the daemon's existing
   `cwdReadableByDaemon` verdict (`accessSync` in `terminal-host-session-create.ts`) is **blind to
   the incident's folder class**, and the `daemon_pty_cwd_denied` telemetry has a structural zero
   for it. The original report's `ls -lde .` success is consistent with this (it only stats).
2. **Daemon-spawned shells carry the daemon's effective grant.** On the production adopted daemon
   (spawned by 1.4.207-adhoc, app now 1.4.206), the daemon's verdict, a login-wrapped shell's
   `scandir`, and a control shell agreed on `~/Documents`, `/tmp`, and Full-Disk-Access-gated
   `~/Library/Safari`. `responsibility_get_pid_responsible_for_pid` reports the daemon and each
   shell as its own responsible pid, never Orca main, yet the shells read Safari, which only
   `com.stablyai.orca` holds. `com.stablyai.orca.helper` has no TCC row of its own.
3. **The login wrapper is unconditional in production**: 1734 of 1734 recorded spawns were
   `wrapped`.
4. **The incident itself has never been reproduced** (2026-09-01 matrix, 2026-09-21 run). Field
   recovery for the one confirmed case reportedly required daemon restart **plus**
   `tccutil reset SystemPolicyDocumentsFolder com.stablyai.orca` and re-allowing.

## 2. Design

Two layers. Layer A ships first and is small. Layer B is the previous helper design, built only
if evidence says the population it covers matters.

### Layer A — enumeration verdict in the daemon, notice in the app (ship now)

**Daemon.** Replace `isCwdReadableByThisProcess` in
`src/main/daemon/terminal-host-session-create.ts` with real enumeration: `fs.opendirSync(cwd)`,
one `dir.readSync()`, `dir.closeSync()`. `EPERM`/`EACCES` → `false`. `ENOENT`/`ENOTDIR`/anything
else → `true`, exactly as today, so a non-permission failure never masquerades as denial. Keep the
wire field name and type (`cwdReadableByDaemon?: boolean`); its meaning becomes "enumerable by
the daemon". Old clients read it unchanged. This runs where `accessSync` already runs (before the
fork, synchronous, local paths only, skipped for WSL).

**Main: evidence.** In `src/main/daemon/daemon-pty-session-spawn.ts`, next to the existing
`trackDaemonPtyCwdDeniedIfDiverged` call, record proven divergence in a new
`src/main/daemon/daemon-folder-access-mismatch.ts`: `{ canonicalPath, daemonIdentity: { pid,
startedAtMs, launchNonce }, appSessionId, observedAtMs }`. The app-side comparison uses the same
`opendir`/one-`readdir`/`closedir` sequence (switch `trackDaemonPtyCwdDeniedIfDiverged` from
`accessSync` to it as well). Keep at most one entry per daemon identity; a later spawn that
enumerates successfully on that identity clears it. `canonicalPath` is the cwd actually sent to the
daemon; no `realpath`, no case folding. Local current-protocol adapter only; SSH, WSL, relay,
legacy adapters, and local fallback providers never write evidence.

**Main: IPC.** Extend the existing `pty:management:macTccAttribution` handler in
`src/main/ipc/pty-management.ts` to return
`{ health, folderAccessMismatch: { daemonScope: string } | null }` where `daemonScope` is a
stable hash of the daemon identity. Mirror the type in `src/preload/api/pty-management-api.ts`
and return `null` from `src/renderer/src/web/preload-api/web-terminal-api.ts`. No new channel,
no push event.

**Renderer.** In `src/renderer/src/hooks/useMacTccAttributionSeveredNotice.ts` add a second toast
(`mac-daemon-folder-access-mismatch`) driven by the same focus-time poll, latched per
`daemonScope` per app session, dismissable per scope. Copy (final wording depends on gate G1):

> **Orca's terminal service can't read a folder Orca can.**
> The terminal service was denied access to a workspace folder that Orca itself can read.
> Restart the daemon from Manage Sessions. If macOS asks again, allow the folder. This closes all
> running Orca terminals and agents.

Action: the existing **Open Manage Sessions** target and the existing restart confirmation in
`useDaemonActions`. Keep the severed-attribution toast separate.

**Recovery and clearing.** Use `restartDaemon()` unchanged. Evidence is keyed by daemon identity
and a restart always replaces the identity, so the next poll returns `null` and the hook dismisses
the toast. If the replacement daemon is also denied, the next spawn re-records and re-toasts. No
post-restart probe: the next terminal spawn is the probe.

**Telemetry.** `daemon_pty_cwd_denied` becomes meaningful for the Documents class. Add
`daemon_folder_access_notice` with `{ action: shown | dismissed | restart_clicked }` and the
existing `cwd_class` enum; no paths.

**Tests.** Extend `terminal-host-cwd-readability.test.ts` for opendir mapping (EPERM, EACCES,
ENOENT, ENOTDIR, readable, empty directory). Unit-test the evidence store (records only on
divergence, one per identity, clears on success or identity change). IPC handler shape. Hook:
toast once per scope, dismissal latch, clears when the poll returns `null`, no toast when both
sides fail or the path is missing. No Electron perf gate is needed: nothing new runs on the
spawn path beyond one `opendir`.

**Accepted gap.** Daemons already running pre-change code (every adopted daemon deployed today)
never produce the enumeration verdict. They are covered after their next restart or reboot, so
each user is blind for at most one update cycle. Layer B exists for that population.

### Layer B — helper probe for already-deployed old daemons (evidence-gated, unchanged design)

The 2026-09-14 design (signed helper launched through `createOrAttach` with `shellOverride`,
neutral cwd, nonce-framed single record, direct and login-wrapped strategies, lease and cleanup
contract, one active plus one queued per daemon, Electron A/B performance gate) is the only path
that observes an old daemon's view without new daemon code. Build it only if, after Layer A ships:

- PostHog `daemon_adopted` shows the adopted-old-daemon population is large enough that a
  one-cycle blind spot matters, or
- gate G1 shows the daemon's in-process verdict disagrees with its shells (the daemon enumerates
  but the terminal is denied), which would mean Layer A's oracle is wrong for the broken state.

If Layer B is built, do not route it through the plan's createOrAttach-plus-lease machinery for
new daemons; new daemons get a single capability-gated `directoryAccessProbe` request built on the
existing `ptySpawnHealth` pattern (`runPtySpawnHealthProbe` in
`src/main/daemon/pty-subprocess/spawn-preflight.ts`) with cleanup on `onClientDisconnected`.

## 3. Open gates

- **G1 — affected machine, remedy and oracle.** On a machine showing the failure, inside the
  affected Orca terminal:
  1. `python3 -c "import os; list(os.scandir(os.path.expanduser('~/Documents')))"` → expect EPERM.
  2. Settings → Terminal → Manage Sessions → Restart daemon. Open a new terminal, rerun step 1.
  3. If still denied: `tccutil reset SystemPolicyDocumentsFolder com.stablyai.orca`, re-allow
     when prompted, rerun step 1.
  Decides whether the notice says "restart" or "restart, then re-allow", and whether the daemon
  identity is what breaks (step 2 fixes it) or the app's grant (step 3 fixes it).
- **G2 — population.** PostHog: count of `daemon_adopted` per week, split by
  `app_version_match`. Ignore `daemon_pty_cwd_denied` for now: it is structurally zero for the
  Documents class until Layer A ships.
- **G3 — Documents prompt behaviour on a signed build.** Confirm the daemon's `opendir` on a
  never-granted Documents folder does not raise a consent prompt attributed to the helper bundle.
  On this machine the grant-less probe was denied silently; verify once on a signed build with a
  fresh TCC profile.

## 4. Action items

1. Send G1 to the affected user (draft below). Owner: Jinwoo.
2. Run G2 in PostHog. Owner: whoever holds PostHog access.
3. Land this doc and the 2026-09-21 evidence on PR #21740; keep the durable-relocation design
   separate and unblocked.
4. Implement Layer A in one PR against `main` (daemon verdict, evidence store, IPC field, toast,
   tests). Do not wait on G1 for the code; G1 only changes the copy.
5. Decide Layer B after two release cycles of Layer A telemetry.

Draft for G1:

> Hi Jinjing — for the Documents-folder terminal issue, could you run three quick things inside
> the affected Orca terminal and paste the outputs? (1)
> `python3 -c "import os; list(os.scandir(os.path.expanduser('~/Documents')))"`. (2) In Orca:
> Settings → Terminal → Manage Sessions → Restart daemon, open a new terminal, run (1) again.
> (3) Only if (2) still fails: `tccutil reset SystemPolicyDocumentsFolder com.stablyai.orca`,
> allow the folder when macOS asks, run (1) once more. Which step made it work tells us where the
> permission is breaking. Thanks!

## 5. Non-goals

Automatic restart, continuous polling, parsing arbitrary terminal output, Python or shell-command
fallbacks, failed-admission and restore triggers (the verdict exists only on a completed spawn;
a rejected folder-workspace admission is an app-side failure, not a mismatch), and any claim of
proven TCC corruption.
