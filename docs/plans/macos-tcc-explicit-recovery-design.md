# STA-7948: macOS daemon folder-access mismatch — finalized plan

Status: finalized 2026-09-21 after live evidence on a production adopted daemon and PostHog field
data. Supersedes the 2026-09-14 helper-first design. No production code yet.
Evidence: [validation/README.md](validation/README.md) (sections "2026-09-21 live evidence" and
"PostHog field data").

## 1. What is settled

1. **The failure is real, common, and tied to app updates.** PostHog `daemon_pty_cwd_denied`
   (shipped in #18043, 2026-09-01) fires only when the daemon reports the cwd unreadable and the
   app can read it. In the 21 days to 2026-09-21 it fired for 1,438 users (5,674 events on
   Documents, 2,379 on Desktop, 369 on Downloads). 1,374 of those users were in a protected folder
   class, and 96% carried `app_version_match=different`, i.e. an adopted daemon forked by an
   older app build. That is 2.8% of the 50,876 users who adopted a different-version daemon.
   Denials recur: 528 users hit it on two or more days.
2. **The daemon's existing verdict detects it.** The field data above is produced by the
   current `accessSync(R_OK|X_OK)` check in `terminal-host-session-create.ts`, so no new daemon
   code is required to observe the failure on daemons that already ship that field. A separate
   grant-less launchd probe on this machine showed a different TCC mode on `~/Documents`
   (`access()` passes, `opendir` fails), so enumeration is the more faithful check and Layer A
   switches to it, but detection does not wait on that.
3. **A fresh daemon from the current app fixes most cases, not all.** Among denied users whose
   later history is visible, 151 stopped being denied after a same-version daemon appeared and
   68 were denied again even with a same-version daemon (about 69% versus 31%). The 31% need the
   folder grant itself repaired (`tccutil reset SystemPolicyDocumentsFolder com.stablyai.orca`
   and re-allow), which matches the one hands-on recovery on record.
4. **Daemon-spawned shells carry the daemon's effective grant.** On the production adopted
   daemon here (healthy), the daemon's verdict, a login-wrapped shell's `scandir`, and a control
   shell agreed on `~/Documents`, `/tmp`, and Full-Disk-Access-gated `~/Library/Safari`. The
   shells report themselves as their own responsible pid yet read Safari, which only
   `com.stablyai.orca` holds; `com.stablyai.orca.helper` has no TCC row. The login wrapper is
   unconditional in production (1,734 of 1,734 spawns `wrapped`).
5. **The user-visible symptom** (Slack, 2026-09-20): inside a workspace under `~/Documents`,
   `ls -lde .` works (stat only), `os.scandir('.')` and opening a file both fail with EPERM, and
   Codex starts then dies with "Operation not permitted" reading its cwd. Commands that do not
   touch the folder work. macOS 26.5.1.

## 2. Design

One layer. The previous helper probe is dropped (section 4).

**Daemon (hardening, not a prerequisite).** Replace `isCwdReadableByThisProcess` with real
enumeration: `fs.opendirSync(cwd)`, one `dir.readSync()`, `dir.closeSync()`. `EPERM`/`EACCES` →
`false`; `ENOENT`/`ENOTDIR`/anything else → `true`, exactly as today. Keep the wire field name and
type (`cwdReadableByDaemon?: boolean`). Runs where `accessSync` already runs.

**Main: evidence.** In `src/main/daemon/daemon-pty-session-spawn.ts`, next to the existing
`trackDaemonPtyCwdDeniedIfDiverged` call, record proven divergence in a new
`src/main/daemon/daemon-folder-access-mismatch.ts`: `{ canonicalPath, cwdClass, daemonIdentity:
{ pid, startedAtMs, launchNonce }, appSessionId, observedAtMs }`. The app-side comparison uses
the same `opendir`/one-`readdir`/`closedir` sequence (switch the telemetry emitter to it too).
Keep at most one entry per daemon identity; a later spawn that succeeds on that identity clears
it. `canonicalPath` is the cwd sent to the daemon; no `realpath`, no case folding. Local
current-protocol adapter only. Daemons that omit the field (pre-#18043) produce no evidence.

**Main: IPC.** Extend the existing `pty:management:macTccAttribution` handler to return
`{ health, folderAccessMismatch: { daemonScope: string, cwdClass } | null }`. Mirror the type in
`src/preload/api/pty-management-api.ts`; the web fallback returns `null`. No new channel.

**Renderer.** In `useMacTccAttributionSeveredNotice.ts` add a second toast
(`mac-daemon-folder-access-mismatch`) on the same focus-time poll, latched per `daemonScope` per
app session, dismissable per scope. Copy:

> **Orca's terminal service can't read your Documents folder.**
> Terminals opened in this folder will fail with "Operation not permitted" even though Orca
> itself can read it. Restart the daemon from Manage Sessions; this closes all running Orca
> terminals and agents. If it still fails afterwards, re-allow the folder for Orca in System
> Settings → Privacy & Security → Files and Folders.

Substitute Desktop/Downloads from `cwdClass`. Action: the existing **Open Manage Sessions** target
and the existing restart confirmation in `useDaemonActions`. Keep the severed-attribution toast
separate.

**Recovery and clearing.** Use `restartDaemon()` unchanged. Evidence is keyed by daemon
identity; a restart replaces the identity, so the next poll returns `null` and the hook dismisses
the toast. If the replacement daemon is also denied (the 31% case), the next spawn re-records and
re-toasts, now with the re-allow sentence doing the work. No post-restart probe.

**Telemetry.** Add `daemon_folder_access_notice` with `{ action: shown | dismissed |
restart_clicked, cwd_class }`. Keep `daemon_pty_cwd_denied` as the denominator.

**Tests.** `terminal-host-cwd-readability.test.ts` for opendir mapping (EPERM, EACCES, ENOENT,
ENOTDIR, readable, empty). Evidence store: records only on divergence, one per identity, clears
on success or identity change, ignores daemons without the field. IPC shape. Hook: toast once per
scope, dismissal latch, clears when the poll returns `null`, no toast when both sides fail or the
path is missing. No Electron perf gate: nothing new runs on the spawn path beyond one `opendir`.

## 3. Open gate

- **G1 — one affected machine, oracle check.** Field data proves the daemon is denied; it does
  not prove the daemon's verdict and the terminal's experience always agree. The one hands-on
  case (Slack) agrees. Ask the affected user, inside the affected terminal:
  1. `python3 -c "import os; list(os.scandir(os.path.expanduser('~/Documents')))"` → expect EPERM.
  2. Settings → Terminal → Manage Sessions → Restart daemon. New terminal, rerun step 1.
  3. If still denied: `tccutil reset SystemPolicyDocumentsFolder com.stablyai.orca`, re-allow when
     prompted, rerun step 1.
  This confirms the copy, not the code.

Closed: G2 (population, above). G3 (prompt behaviour of the daemon's `opendir` on a signed build)
is folded into the Layer A PR's manual check.

## 4. Why the helper probe is dropped

It existed to observe daemons running code that predates the verdict. Every daemon that has
produced the field data above already ships the verdict, and daemons older than #18043 age out
with the next restart or reboot. A signed helper, PTY-launched probe, lease registry, and
second daemon client would buy coverage of a population that is already shrinking to zero.

## 5. Action items

1. Ship the design above in one PR against `main`. Owner: engineering.
2. Send G1 to the affected user (draft below). Owner: Jinwoo. Changes copy only.
3. After one release: read `daemon_folder_access_notice` against `daemon_pty_cwd_denied` to
   confirm the toast reaches the denied population, and watch whether the 31% re-toast rate
   holds.
4. Separately, reopen the prevention question with the field numbers: 2.8% of updaters losing
   folder access to their terminals is not a two-report curiosity. The durable-relocation design
   stays a separate doc.

Draft for G1:

> Hi Jinjing — for the Documents-folder terminal issue, could you run three quick things inside
> the affected Orca terminal and paste the outputs? (1)
> `python3 -c "import os; list(os.scandir(os.path.expanduser('~/Documents')))"`. (2) In Orca:
> Settings → Terminal → Manage Sessions → Restart daemon, open a new terminal, run (1) again.
> (3) Only if (2) still fails: `tccutil reset SystemPolicyDocumentsFolder com.stablyai.orca`,
> allow the folder when macOS asks, run (1) once more. Which step made it work tells us where the
> permission is breaking. Thanks!

## 6. Non-goals

Automatic restart, continuous polling, parsing arbitrary terminal output, Python or shell-command
fallbacks, failed-admission and restore triggers (the verdict exists only on a completed spawn;
a rejected folder-workspace admission is an app-side failure, not a mismatch), and any claim of
proven TCC corruption.
