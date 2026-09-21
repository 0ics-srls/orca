# Structured native chat in the floating workspace

Follow-up to #21390. That PR routed the floating launch button through the shared launcher and made
it honour the chat-view default. This one makes the floating workspace able to host a real
structured session.

## What works today, after #21390

With `experimentalNativeChat` + `openAgentTabsInChatByDefault` on, the floating launch button opens
the **terminal-backed** chat view: a chat interface drawn over a live agent TUI, with the user's
model and effort preferences applied. It renders because `TerminalPaneNativeChatPortal` portals into
the pane's own container, and the floating panel already hosts that pane.

What it does not do is open a **structured** session, the way the main window does with
`experimentalStructuredNativeChat` on. That is the gap here.

## Why structured does not work in the floating workspace

Not a renderer problem at root. A structured session record persists **no path**:

- `AgentSessionRecord` (`src/shared/agent-session-record.ts:125-142`) carries
  `location: { executionHostId, wslDistro, workspaceId, workspaceKind }` and nothing else
  place-like.
- The working directory is re-derived from `location.workspaceId` on **every** acquisition — create
  and resume alike — in both providers:
  `src/main/claude/claude-structured-launch-resolution.ts:245`,
  `src/main/codex/codex-structured-launch-resolution.ts:81`,
  `src/main/claude/claude-tui-resume-launch.ts:95`.
- The resolver (`src/main/runtime/orca-runtime-get-worktree-ps.ts:149`) maps `id:<workspaceId>` to a
  **worktree row** and reads `.path`.
- The session journal is workspace-keyed too:
  `<userData>/agent-session-journal/<sha256(workspaceId)>/<sha256(sessionId)>/journal.db`
  (`journal-paths.ts:26-36`).

`FLOATING_TERMINAL_WORKTREE_ID` is `'global-floating-terminal'`, a constant rather than a row, so
that lookup has nothing to return. `parseWorkspaceKey` (`workspace-scope.ts:15-25`) understands only
`worktree:` and `folder:`, and `AgentSessionWorkspaceKind` (`:24`) is `'git-worktree' | 'folder'`.

The floating workspace does have a directory — `floatingTerminalCwd`, resolved main-side at
`src/main/ipc/app.ts:317`. What it lacks is an identity the host can resolve. The blocker in
`resolveStructuredNativeChatSupport` follows from that; it is the only member of
`StructuredNativeChatBlocker` with no doc comment.

Keying by id rather than path is deliberate and should not change: it is what makes a git worktree,
a folder workspace, a WSL distro and an SSH host interchangeable, it survives a workspace being
moved, and it keeps the host deriving the location from its own records rather than trusting a
caller-supplied path.

## The plan

### 1. Make the floating workspace resolvable

Teach `resolveWorkspacePath` to answer for the floating sentinel using the resolved
`floatingTerminalCwd`. The resolution already exists behind `app:getFloatingTerminalCwd`; this is
wiring, not new behaviour.

### 2. Record the directory the session actually ran in

Add an optional resolved-path field to the session's location, written at create. At launch and
resume, prefer it when it still exists on disk and fall back to the id-derived location when it does
not.

This matters because `floatingTerminalCwd` is a user setting that can be repointed at any time.
Without it, repointing the floating folder silently moves where every existing floating chat
resumes. The path stays a **verified cache over the id**, never the authority — the id remains what
the journal is keyed by and what a resume trusts when the cached path is gone.

Check that adding an optional field does not disturb `isAgentSessionExecutionLocation`
(`agent-session-record.ts:193-203`); it validates named fields, so an extra optional one should pass,
but confirm rather than assume.

### 3. Label floating sessions `'folder'`

Do **not** add a third member to `AgentSessionWorkspaceKind`. It is validated as a closed enum on
every persisted row (`agent-session-record.ts:201`, `agent-status-subject.ts:80`) and participates in
the ownership identity comparison (`structured-agent-session-status-ownership.ts:34`). A new value
means a schema bump and an older build rejecting the new rows.

`'folder'` describes how Orca manages the place — a directory the user pointed it at, rather than a
git worktree Orca created — not whether the directory contains a repo. Folder workspaces routinely
contain repos. Neither of the two sites that read the label branches on it behaviourally; both only
check it is one of the allowed values.

### 4. Lift the blocker

Remove the `workspaceKind === 'floating'` branch from `resolveStructuredNativeChatSupport`, update
its tests, and give the remaining blockers the doc comment this one never had.

### 5. Render it in the floating panel

`StructuredAgentSessionPaneOverlayLayer` is already generic over `worktreeId` and is mounted once at
`TerminalWorktreeSplitSurface.tsx:92`. Preferred approach is to mount it for
`FLOATING_TERMINAL_WORKTREE_ID`, which needs two supporting changes:

- Its slots position through `RetainedPaneHost`, which anchors to `[data-tab-group-body-id]` —
  emitted only by `TabGroupPanel.tsx:338`. The floating panel does not use `TabGroupPanel`; it
  renders each pane type directly. It needs to publish that anchor.
- `use-floating-terminal-panel-items.ts` computes `activeEditorUnifiedId` as "any tab that is not
  terminal, browser or simulator", so an `agent-session` tab is currently misread as a file-editor
  tab. Exclude it.

`TabBar` already renders `agent-session` items (`tab-bar-item-surface.tsx:230`), so the tab strip
needs nothing.

Fallback if the anchor fights the panel's fixed-position shell: render
`NativeChatView mode="structured"` directly, the way the panel already renders `TerminalPane`. More
code, same approach the panel already takes for every other pane type.

## Worth fixing while we are here

Orca has no fallback when a session's workspace has moved or been deleted — `resolveWorkspacePath`
either resolves or it does not. Step 2 introduces the first one, for the floating case. Consider
whether the same verify-then-fall-back should cover git worktrees removed out from under a session.

## Risk

Steps 1–4 are small and traced. Step 5 carries the uncertainty: the floating panel is a parallel tab
surface rather than a user of the shared one, which is why every pane type has had to be added to it
by hand. If that turns out to be more than a day, the panel's divergence from `TabGroupPanel` is the
real debt and worth raising separately rather than absorbing here.

## How to validate

- Launch structured chat in the floating panel and confirm it is genuinely a session, not a terminal
  wearing a chat UI: no chat/terminal toggle in the pane header, and a `journal.db` under the
  workspace hash.
- Restart the app and confirm the session resumes in the floating panel.
- Repoint `floatingTerminalCwd` in Settings and confirm an existing session still resumes in the
  directory it originally ran in.
- Delete that directory and confirm the session falls back rather than failing to launch.
- Confirm a floating launch still does not move the main window's active tab.
