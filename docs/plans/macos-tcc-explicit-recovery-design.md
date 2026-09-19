# macOS terminal permission recovery: detection for surviving daemons

Status: revised after independent review and local prototype validation, 2026-09-14.
No production implementation. Probe transport and cleanup are demonstrated; detection of
the reported TCC failure is not yet demonstrated. See [validation evidence](validation/README.md).
The durable prevention design is [macos-tcc-durable-relocation-design.md](macos-tcc-durable-relocation-design.md).

## 1. Final design

Detect the access failure, then point to the existing restart action:

1. When the user attempts to open or restore a local macOS terminal, including failed attempts,
   check the requested workspace directory through the adopted daemon.
2. Run a tiny directory-read executable in a disposable daemon-owned PTY. This works through
   the existing protocol without running user shell startup files or touching an existing terminal.
3. If the check returns EPERM or EACCES, attempt the same read from Orca. Only when Orca succeeds
   show the existing permission notice suggesting restart and warning that terminals and agents stop.
4. Link to **Manage Sessions → Restart daemon** and reuse the existing confirmation.
5. After the explicit restart, repeat the check before claiming that access recovered.

No polling, folder scanning, terminal counts, new dialog, or automatic restart. Coalesce
concurrent checks; inconclusive results do not trigger a permission diagnosis.

Performance contract: the probe is off the terminal-readiness path. Measure terminal-open
time-to-first-prompt with probing enabled and disabled; the implementation must show no measurable
readiness regression and must cap work at one active probe plus one queued request per daemon.
Record bounded helper-spawn, PTY setup, app-read, cleanup, and total durations. Restore bursts
and reconnect storms are required stress cases; process/PTY churn must remain bounded by the
coalescing and cooldown rules below.

This supports investigating already-running daemons whose negotiated protocol already has the
existing create/cleanup fields; it does not require a new RPC. It adds no terminal pane,
inventory, counts, renamed controls, or recovery wizard.
A transient diagnostic session can still appear in service listings: old protocols have no
hidden-session flag.

Prevention across updates remains the priority. This recovery is explicit; never restart
automatically or terminate healthy terminals to migrate the launch mechanism.

The decisive release gate is TCC fidelity: the final signed helper must reproduce
the denial of an ordinary terminal on an actually affected old daemon. A prototype running
successfully is not sufficient evidence to ship a TCC detector.

## 2. Why this detector

The reported affected daemon can answer health probes and have an intact launcher path.
App version, executable-path existence, and code-signature metadata do not establish whether
a filesystem operation will be permitted.

Current code provides optional `cwdReadableByDaemon` on new terminal creation, using
`accessSync(R_OK | X_OK)`. App-side divergence is emitted by
`trackDaemonPtyCwdDeniedIfDiverged` as telemetry. Older daemons omit the field, and reattaching
an existing terminal omits it too. Absence is unknown, never success.

Use actual directory enumeration to test the relevant operation, rather than treating
`accessSync` as equivalent. Keep one compatibility detector for adopted daemons initially.
Direct reporting from newer daemons can replace this work later after equivalence is proven.

Do not parse arbitrary terminal output for “EPERM” or “Operation not permitted”. It may be
quoted text or a command failing for unrelated reasons. A new daemon RPC cannot repair the
observability of a process that is already running old code.

## 3. When to check and when to show the notice

Trigger when a user attempts to open or restore a local terminal using an adopted macOS daemon,
once its connection and the requested directory are known. Include failed admission: permission
denial can prevent terminal creation itself. Use the requested workspace directory, whether a
folder workspace or a git worktree. Run asynchronously; the diagnostic must not delay ordinary
terminal readiness or enter automatic daemon-replacement/retry paths. An admission error alone
does not establish the access mismatch; still require the structured diagnostic result.

Coalesce simultaneous requests for the same connection generation and directory. Initially
keep no lasting success cache: later create/reattach activity can discover a newly developed
failure. No periodic timer, protected-folder sweep, or probe on every keystroke.

Allow one diagnostic at a time per daemon. Coalesce restore bursts; use a short bounded
cooldown after an inconclusive attempt, checked only on later terminal activity. A cooldown
is not a health verdict. Bound queued work and discard obsolete workspace/connection requests.

Only after a permission-denied result, perform the equivalent directory read from Electron
main. The result must still belong to the active connection generation when consumed.

| Diagnostic child | App read of the same directory | Behavior |
| --- | --- | --- |
| EPERM or EACCES | Success | Show the existing permission notice with restart guidance. |
| EPERM or EACCES | EPERM or EACCES | No service-specific diagnosis; use existing permission guidance. |
| EPERM or EACCES | Missing path, timeout, other error | Inconclusive; no restart diagnosis. |
| Success | Not needed | No access warning for this check. |
| Missing path, spawn failure, malformed/no result, timeout | Not needed | Inconclusive; no restart diagnosis. |

Suggested notice:

> A check through the terminal service could not access this folder, but Orca can.
> Restarting the service may help. This stops its terminals and running agents.

Reuse **Open Manage Sessions** and the existing restart confirmation. Show once per affected
daemon connection scope per app session; dismissal prevents repeated notices for that scope.
Reconnect/replacement invalidates pending evidence. Use authenticated incarnation identity
when present; with old metadata, use the uninterrupted connection generation rather than a
PID guessed from the current file.

Keep the existing severed-attribution reason separate. It may explain possible permission
trouble, but it does not establish an observed directory-read denial. Neither reason promises
that restart restores permissions.

## 4. Probe transport

Use a small standalone macOS executable as `shellOverride`, with `command` omitted.
Pass target and a random request nonce in dedicated environment variables. Start from an
accessible neutral runtime directory, not the directory being checked.

There are three distinct processes in this flow:

1. **Orca main** owns the diagnostic request, captures the daemon identity, parses the helper
   result, and performs the comparison read under Orca's own filesystem identity.
2. **The existing terminal daemon** is the already-running daemon that owns the user's terminals.
   Orca connects to this exact daemon and asks it to create one temporary diagnostic PTY; the
   check must not restart, replace, or silently adopt another daemon.
3. **The diagnostic helper** is a packaged, one-shot executable launched by that daemon inside
   the temporary PTY. It is not a daemon, does not own or persist a terminal, and exits after one
   directory read. The PTY is only its launch container.

The helper is intentional. Sending a shell command would run startup files, aliases, prompts, or
arbitrary user configuration and would produce output that is unsafe to interpret. The helper
receives only the target path and request nonce through dedicated environment variables, uses the
neutral cwd, performs `opendir`/one `readdir`/`closedir`, and returns no names or file contents.
If the exact packaged helper cannot be launched, the result is `unknown`; the diagnostic path
must never fall back to zsh, another shell, or a normal terminal.

The lifecycle is: Orca main sends the existing create request → the captured daemon launches the
helper in the temporary PTY → the helper emits one bounded result and exits → Orca parses it and
performs its own equivalent read. Client deadlines cover connection, create, output, and cleanup;
the helper also has its own self-expiry. A timeout or lost connection makes cleanup uncertain,
not evidence that the daemon or child died. The exact diagnostic session is cleaned up through the
original daemon connection when possible. Older protocols may briefly expose this temporary
session in listings because they cannot mark it hidden; that bounded visibility is accepted.

This is a deliberate change from the original “fixed command” proposal:

- The existing Unix launch path ordinarily starts a login shell; a command sent through it
  can execute user startup files and interact with shell readiness/history.
- The protocol provides `shellOverride` and environment but no arbitrary argument vector.
  An unknown executable receives the default `-l` argument; the helper must tolerate it.
- Do not assume the app's fresh Electron executable is a suitable oracle. Its identity can
  change attribution, and the normal PTY environment strips `ELECTRON_RUN_AS_NODE`.

The helper performs `opendir`, one `readdir`, then `closedir`. It does not enumerate the
whole directory and never returns filenames or contents. Emit one bounded record containing
the request nonce and an allow-listed outcome/errno, then exit. Validate framing and nonce;
PTY transport may add CRLF, but arbitrary preambles, postambles, duplicate records, and
additional structured-looking output are invalid.

Do not infer success from the PTY exit code: the macOS login wrapper can return zero even
when its child failed. Only the helper's valid result establishes the read outcome.

Use the same operation in main for the comparison; do not launch another helper directly from
the app and assume its identity is equivalent to Electron main's.

## 5. Lifecycle and compatibility

Connect directly to the captured daemon endpoint for diagnostics, using its captured token and
negotiated protocol version; never use the current default protocol against an older endpoint.
Do not use a provider path that may silently respawn or adopt another daemon on error. Do not
inject input into any existing terminal. Assign a unique diagnostic session ID without pane or
agent ownership.

This is a dedicated diagnostic path, not the normal provider spawn path. It may issue only the
raw existing create/attach and cleanup requests through the captured client or an exact-version
direct client. It must bypass provider spawn, daemon retry, replacement preflight, history restore,
fallback routing, and admission retry logic. The diagnostic create always uses a verified,
daemon-readable neutral runtime cwd; the target workspace is passed only in the bounded helper
environment and is never the PTY cwd.

Start the helper's own deadline immediately, before reading the target. Also bound client
connection, create, output, and cleanup work. The prototype uses a five-second helper alarm;
that is demonstrated for an ordinary sleeping child, not an uninterruptible kernel operation.

On timeout/cancellation, attempt cleanup of that exact diagnostic session over the original
connection. Never restart/kill the daemon to clean up the probe. A late legacy create can
outlive the client's request deadline; helper self-expiry is needed because old cancellation
semantics cannot be assumed. Loss of contact means cleanup is uncertain, not that the child died.

No protocol-only hidden flag can make a session invisible to old readers. Accept brief listing
visibility with a recognizable diagnostic name; do not create a new cross-reader filtering
subsystem for this feature. Confirm historical exit/reaping behavior against supported old
binaries; current-daemon cleanup tests do not establish every old release's behavior.

Source inspection of the parent of `a7fda48fe3` (before cwd-readability reporting) confirms
`shellOverride`, `env`, and the Unix launch behavior existed there. This is one compatibility
anchor, not an executed old release or a claim about all legacy protocols. Keep recovery scoped
to local daemon populations whose negotiated protocol has the required fields; SSH, relay,
legacy adapters without those fields, and other profiles remain outside the target.

Package the helper using existing standalone macOS-helper build/signing conventions. Verify the
exact packaged path is executable immediately before issuing the request. Diagnostics must not
use the normal Unix shell fallback chain: if that exact helper cannot be resolved or launched,
return unknown and prove in tests that no fallback shell remains alive.
Verify both architectures, executable permissions, an unpacked runnable location, and the
final signing identity. Do not add Python/Perl/system-command fallback detectors. Failure to
launch the helper yields unknown.

A directory read can trigger a macOS permission prompt. “Background” does not mean guaranteed
silent. Probe only a directory the user has chosen to use.

## 6. Recovery

Use the existing restart action and confirmation. It stops current-protocol local terminals,
including running agents/commands, and degraded local fallback terminals. Preserve SSH and
legacy-protocol sessions. Agents require manual resume.

No new preview IPC, impact inventory, expiring confirmation tokens, or forced escalation on
graceful timeout is part of this design. Fix demonstrated correctness problems in the existing
restart path without introducing a parallel implementation.

In particular, verify premature synthetic exits, partial shutdown, permission-error handling
in signal fallback, ownership changes, and failed replacement. An unsuccessful restart may
already have stopped work. Listener rebinding cannot restore cleared session state. Do not
spawn beside an owner whose survival is unresolved; preserve the endpoint ownership contract.

After an explicit restart prompted by this detector, repeat the directory check against the
replacement, using the same request path. A successful check clears this access warning.
A failed/inconclusive check cannot be reported as recovered. Service readiness and folder
access are separate results; do not promise permissions were granted or agents resumed.

## 7. Validation result and remaining release gates

Completed locally with a second agent's independent protocol/lifecycle review:

- A real isolated daemon process and native PTY launched the prototype helper using existing
  RPC fields, without a shell command or a visible app window.
- Direct and actual login-wrapped launches returned the expected structured result for readable,
  missing, and POSIX-permission-denied directories.
- A target containing spaces, a quote, dollar sign, backticks, and a newline was passed intact.
- Completed diagnostic sessions were absent from current-daemon session inventory.
- Explicit cleanup stopped a stalled child; the helper also self-terminated without client kill.
- Existing cwd-readability, divergence-telemetry, and attribution suites passed: 22 tests.

Not validated: a poisoned TCC lineage, an executed historical daemon binary, final signed helper
attribution, app-versus-daemon divergence under TCC, or permission recovery after restart.
The comparison in the prototype uses a Node driver, not the installed Electron main process.

Before release, reproduce on an affected old daemon:

1. An ordinary terminal directory read fails with a permission denial.
2. The final signed diagnostic helper, through that same daemon's launch path, also fails.
3. Electron main's equivalent read succeeds on that directory.
4. The existing notice offers the existing restart, without counts or another confirmation.
5. After user-confirmed restart, both the diagnostic and ordinary terminal can read it.

Exercise relevant direct and login-wrapped populations, historical create/cleanup behavior,
late create after client timeout, connection replacement, duplicate restores, dismissal,
and same-app-lifetime failure after a previous successful check.

If the helper succeeds while the affected terminal fails, it is not a valid oracle for that
population. Do not weaken the trigger to app-version mismatch to conceal that failure;
revise the execution context based on the reproduction.

## 8. Limits and implementation checks

This detects access for checked workspace directories. A later arbitrary shell command can
access another directory without structured feedback to Orca. Keep manual restart available;
do not claim universal automatic detection.

TCC poisoning is a hypothesis for the observed mismatch. POSIX permissions, path changes, and
other process-specific restrictions must not be described as proven TCC cache corruption.

No production changes were made during validation. Sources and results are retained under
`docs/plans/validation/`; the plan and evidence are currently git-ignored. Relevant typechecks,
native packaging checks, focused regression tests, and hidden Electron UI validation remain
implementation requirements. Use the electron skill and Playwright CDP for rendered checks;
all tests/apps use `ORCA_BACKGROUND_LAUNCH=1`, with no focus or window activation.

## 9. Implementation contract (release-blocking details)

The implementation must preserve these invariants; they are part of the design rather than
optional tactics:

- The probe request carries an immutable `{ connectionId, protocolVersion, connectionGeneration,
  canonicalPath, requestNonce }`. The caller captures all five before opening the diagnostic
  session, and the result is ignored unless all five still match. A path or connection selected
  after the probe
  starts is a race and must not be used for attribution.
- The path comes from the terminal admission/restore request (including failed admission), after
  the existing absolute, lexical workspace-path normalization. Do not call `realpath` as a
  prerequisite or change symlink spelling unless admission already does so. Do not fall back to
  the current tab, cwd reported by a shell, or a path selected by a later restore. Folder
  workspaces use their folder path; git worktrees use the requested worktree path. This exact
  canonical string is used for the helper, app comparison, coalescing, and state keys.
- The daemon diagnostic API is an internal main-process operation. Renderer code may request a
  probe and receive a typed result, but it cannot provide an executable path, environment keys,
  nonce, or daemon endpoint. The main process owns helper-path allow-listing, nonce generation,
  output-size limits, and result parsing.
- The helper result is a versioned, single-record protocol with an exact nonce match and an
  allow-list of `ok | eperm | eacces | missing | other`; malformed, duplicate, over-budget, or
  extra records are `unknown`. Never map arbitrary errno values to permission denial.
- Cleanup is idempotent and keyed by the diagnostic session ID plus connection generation. A
  cleanup acknowledgement is not evidence that a late create did not happen; late creates are
  tracked as an explicit compatibility test and surfaced only in diagnostics.
- Maintain per-path evidence/recovery state. The user-visible shown/dismissed latch is keyed by
  authenticated daemon incarnation when available, otherwise by uninterrupted connection
  generation, plus app-session ID. A successful post-restart probe clears only that canonical
  path's evidence. Reconnect, replacement, logout, and app restart clear pending work; dismissal
  suppresses only the current latch key.
- The app-side comparison uses the same `opendir`/one-`readdir`/`closedir` sequence and maps
  `ENOENT`/`ENOTDIR` to `missing`. It must not use `accessSync`, a recursive scan, or a second
  child process. The comparison runs only after the daemon returns `eperm` or `eacces`, has an
  absolute deadline, and resolves timeout to `unknown` without blocking the renderer or main
  event loop. The underlying kernel call may remain uninterruptible; release the diagnostic slot
  and record bounded telemetry rather than waiting indefinitely.
- Revalidate `{connectionId, protocolVersion, connectionGeneration, canonicalPath, requestNonce}`
  after the app read and immediately before committing notice state. Evidence that becomes stale
  during the comparison is `unknown`.
- A probe is best-effort and never participates in terminal admission, retry, daemon replacement,
  or renderer startup readiness. Every timeout, transport error, stale-generation result, and
  helper launch failure resolves to `unknown` and is observable in bounded debug telemetry.

The minimum automated coverage is: readable/missing/permission-denied directories; spaces,
quotes, shell metacharacters, and newlines in paths; helper output framing and nonce attacks;
login-wrapped and direct launch; duplicate restore coalescing; timeout followed by late create;
connection replacement; dismissal scoping; a second failure after an earlier success; and a
successful and unsuccessful explicit restart. Test the oldest supported daemon protocol that has
the required fields, plus one daemon with and one without the production login wrapper. Add one
end-to-end Electron test that verifies the existing notice and restart confirmation without
activating or showing a window.
