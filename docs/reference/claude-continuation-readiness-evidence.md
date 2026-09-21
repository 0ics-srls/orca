# Claude continuation readiness evidence (#21896)

Reproduced before implementation changes at `169bccc544d`, using Claude Code
2.1.278 on macOS and 2.1.272 on native Windows through the `awin` runtime.

## Captured PTY reproduction

The standard `capture-agent-pty-transcript.mjs` recorder ran at 100 columns by
32 rows. `CLAUDE_CONFIG_DIR` pointed to a disposable copy of the user's config,
with only that copy's `bypassPermissionsModeAccepted` removed. The normal
profile was not modified.

Fixtures under `src/main/runtime/__fixtures__/`:

- `claude-bypass-dialog`: no input for 12 seconds. The warning stays open with
  **No, exit** selected. Exit 129 is the recorder stopping the capture.
- `claude-bypass-paste-exit`: same starting state; at 6000 ms send bracketed
  paste containing `Continuation reproduction marker`, then Enter at 6050 ms.
  Claude exits itself with code 1.
- `claude-bypass-to-composer`: same starting state; Down + Enter at 5000 ms
  accepts the warning in the disposable profile. The composer then renders.
  Exit 129 is the recorder stopping the capture.

Raw bytes and capture metadata are preserved. The recorder's privacy scanner
passes after same-length redaction of the workspace label.

Replaying the dialog bytes through `createDraftPasteReadyScanner` with
`render-quiet-after-bracketed-paste` returns
`{ ready: false, armQuietTimer: true }`. Claude enables DECSET 2004 before
the dialog and remains quiet, so the caller resolves readiness after 1500 ms.

## Orca reproduction

A hidden Electron build from this worktree used an isolated Orca profile and
the same disposable Claude config. Invoking the real
`launchAgentSessionContinuation` with the marker above opened Claude, pasted
and submitted into the warning, and returned to the shell. The CDP screenshot
was inspected: it shows the warning followed by the shell prompt. This used
the actual continuation launcher, but not the context-menu/dialog clicks.

On native Windows, a new Orca-managed reproduction worktree and an explicitly
selected PowerShell terminal ran Claude against a separate copied config.
The warning remained visible before input. `orca terminal send --text
'Continuation reproduction marker' --enter` accepted the input and the pane
returned to PowerShell. This independently reproduces the input hazard on
Windows. The patched Windows continuation launcher was subsequently exercised
as described below; context-menu/dialog clicks were not part of either run.

## Related mechanisms

- #15859 (Devin) and #11765 (Cursor): first-run menus consume automatic input.
- #18080 / #18084: Claude workspace trust is separate from bypass acceptance;
  pre-trusting a directory does not establish that the composer owns input.
- #18088 / #21657 / #21770: Antigravity continuation exposed the same readiness
  assumption and an additional Windows PTY-binding deadline. GitHub reports
  those PRs merged into stacked feature branches (`nwparker/agy-onboarding-install`
  and `nwparker/agy-legacy-setup`), not main. The current fetched `origin/main`
  does not contain their host-readiness delivery path.

The renderer has two ways to admit unsafe input: its quiet-window signal and
a timeout fallback based on process ownership. Both must be considered.
`runtime-worktree-startup-readiness.ts` separately uses the same scanner for
drafts and process ownership for follow-up submission. The existing runtime
terminal wait/readiness infrastructure should be assessed for reuse before
introducing another screen parser or readiness store.

The intended invariant is that automatic prompt delivery requires evidence
that the target agent's composer accepts input. Silence, a matching process,
or absence of a recognized warning does not establish that invariant.

## Implementation and validation

The host's existing `terminal-composer-draft` parser now exposes empty-composer
readiness using the active cursor and composer frame, including stock placeholder
text. `terminal.read --screen` publishes that evidence as an optional field.
Claude's automatic draft/continuation delivery requires it, including a recheck
inside the paste transaction; a timeout cannot fall back to process presence.
Runtime worktree startup uses the same host screen evidence. Other providers keep
their existing policies until their composer evidence is validated.

The hidden macOS build held the bypass warning, then delivered the exact test
prompt after an explicit Down and Enter selected acceptance. The rendered agent
showed the submitted prompt followed by `Not logged in`; the disposable profile
therefore proves delivery but not successful model generation. Accepting the
warning also sets `skipDangerousModePermissionPrompt` in the disposable
`settings.json`; reset it as well as the JSON acceptance flag for repeat captures.

The hidden Windows build (Claude 2.1.272) also ran the real continuation launcher.
After ten seconds, the rendered warning still selected **No, exit**, no prompt had
been delivered, and `terminal.read --screen` reported `composerReady: false`.
After explicit Down + Enter, the screen showed the exact submitted prompt
`Reply with REPRO_21896_WINDOWS only. Do not run commands or modify files.`
followed by `Not logged in`. CDP screenshots of the held warning, selected
acceptance, and delivered prompt were inspected. The Windows dependency setup
needed a shorter disposable pnpm store and `NODE_PATH` for native module resolution;
no production build-policy changes were made.

The final local runs cover 138 distinct tests: transcript publication, composer
matching, renderer readiness and delivery, startup drafts/followups, terminal
projection, and runtime ownership (including folder workspaces). Full `pnpm tc`,
targeted `oxlint`, and the changed-code quality gate pass. Native Windows passes
118 distinct focused tests. Runtime transcript tests
replay at the recorded 100×32 geometry through `onPtyData`, not just the matcher.

Paired-host tests cover owner routing, older hosts, disconnection, agent identity,
and PTY replacement/incarnation changes. The new optional screen field is advertised
by a runtime capability. A newer client refuses automatic Claude delivery on a host
without that capability; it does not revive the unsafe process fallback. No live SSH
continuation was run. The existing folder/runtime owner routing is reused without a
Git-worktree dependency.

## Published visual evidence

Screenshots are cropped to the terminal; gray rectangles redact the local shell
account/hostname. No terminal output relevant to the behavior is changed.

![macos-before.png](https://github.com/user-attachments/assets/27626d2d-2ed8-43a4-a560-0b33ed1132e4)
![macos-warning-held.png](https://github.com/user-attachments/assets/89018948-3c88-4d60-be93-97d6b1ea3324)
![macos-delivered.png](https://github.com/user-attachments/assets/590c99ce-0cbc-485a-9966-9b172aecc1c2)
![windows-warning-held.png](https://github.com/user-attachments/assets/889efc56-8a1a-4caf-ae08-80ab297760df)
![windows-delivered.png](https://github.com/user-attachments/assets/46fb23b0-66f0-4f92-b5c7-fc93c1a3ad03)

## Related issue coverage

Only #21896 is claimed fixed. #15859 (Devin), #11765 (Cursor), and #18088
(Antigravity) retain their existing agent policies. The shared host evidence path
can support more agents after their composer screens are captured and tested.
#18080 concerns a folder-trust dialog hidden by the native chat view; preventing
unsafe input does not restore access to that dialog. #18084 was closed without
merging. #21657 and #21770 are related Antigravity fixes merged into feature
branches, not into this change; this PR does not supersede that stack.
