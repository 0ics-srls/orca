# Make the floating workspace a first-class workspace

Follow-up to #21390. The host half is done (commit `3fc38da5c6`); this document covers the
renderer half, which is the real work.

## The one cause behind three symptoms

The floating panel does not use the shared workspace surface. `FloatingTerminalPanelSurface.tsx`
re-implements the tab body by hand: it maps tabs to `TerminalPane`, `FloatingBrowserSlot`,
`EmulatorPane` and `EditorPanel` itself, and it renders exactly one group
(`use-floating-terminal-panel-items.ts:27-38` picks `groups.find(g => g.activeTabId != null)` and
filters tabs to it).

Three consequences, all the same bug:

1. **Splitting a floating tab loses it.** The tab moves to a second group and the panel keeps
   drawing the first. Nothing is deleted — the row and its PTY survive — but nothing renders it.
   Present on `origin/main`; verified by diff.
2. **No structured chat.** There is no `agent-session` branch in the hand-written body, so a
   session created there would have no surface.
3. **Every new pane type needs porting by hand**, which is why 1 and 2 exist at all.

Patching any one of these separately adds a fourth hand-written branch. The fix is to stop
hand-writing the body.

## What replaces it

`WorktreeSplitSurface` (`src/renderer/src/components/TerminalWorktreeSplitSurface.tsx`, 99 lines)
is what every other workspace uses, and it is already generic over `worktreeId`:

```
TabGroupSplitLayout               renders the whole group tree — splits included
TerminalPaneOverlayLayer          terminals; already takes coldParkTerminalPanes / isForceParked
RetainedBrowserPaneOverlayLayer   browser
EmulatorPaneOverlayLayer          emulator
StructuredAgentSessionPaneOverlayLayer   structured chat
AiVaultSessionDropLayer           vault drops
```

It works for floating because nothing in the chain needs a `Worktree` row.
`useTabGroupWorkspaceModel` reads only `groupsByWorktree`, `unifiedTabsByWorktree`,
`tabsByWorktree` and `browserTabsByWorktree`, all of which the floating workspace already fills,
and its model already exposes `agentSessionItems`. Layout is populated per worktree id in
`tabs-hydration.ts:222`, and floating is an admitted workspace id
(`tabs-session-actions.ts:83`).

**Keep the shell, replace the body.** The shell — bounds, dragging, resize handles, maximize,
titlebar, window controls, the orchestration and save dialogs — is genuinely floating-specific and
stays. The body becomes one `WorktreeSplitSurface`.

## Steps

1. **Render the shared surface.** Mount `WorktreeSplitSurface` in the floating shell with
   `worktreeId = FLOATING_TERMINAL_WORKTREE_ID` and `worktreePath` = the resolved floating cwd the
   panel already holds. Note `TerminalPaneOverlayLayer:129` bails on an empty path, so the existing
   "no cwd yet" gate is partly inherited rather than re-implemented.
2. **Delete the hand-written body** from `FloatingTerminalPanelSurface.tsx` — the tab-to-pane maps
   and the single-group projection in `use-floating-terminal-panel-items.ts`. Deleting this is the
   point of the change; leaving it beside the new path would be the failure mode.
3. **Re-home what is genuinely floating** (see the table below).
4. **Prove the UI did not change** (see the evidence section).

## The behaviours that must survive, and where each lands

| Behaviour | Where it is now | Where it goes | Risk |
|---|---|---|---|
| Cold terminal parking | `parkedTerminalTabIds` in the panel | Already props on the shared layer: `coldParkTerminalPanes`, `isForceParked` | Low — pass them |
| "Not until the panel has settled" mount gate | `cwd && panelViewportSettled` | Partly inherited via the empty-`worktreePath` bail; the maximize-restore timing still needs an explicit gate | Medium — a restored-maximized panel must not fit a live TUI to a grid it is about to leave |
| Markdown + browser creators | Floating tab strip | Shared creation commands already exist, but they are `openNew…InActiveWorkspace` variants | **High — must target the floating group, not the active workspace** |
| Floating selection stays out of the global selection | `activate: false` + `activateTab` (#21390) | Group-scoped selection in the shared model | **High — regressing this breaks the `agent-auto-ack-targets` invariant** |
| Tab drag | `FloatingWorkspaceTabDragContext` | `TabGroupSplitLayout`'s own dnd | **High — two drag systems must not both be live** |

The three High rows are the actual cost of this change. Each gets a test that fails without it.

## What "good" means here

- **One surface, not two.** If the change ends with a floating-only rendering path still in the
  tree, it has failed regardless of whether chat works.
- **No flag.** A flag would mean maintaining both surfaces; the point is to have one.
- **No new floating branch inside shared components.** If a shared component needs to know it is
  floating, that is a signal the seam is wrong — prefer passing a prop the shared component already
  understands (as `worktreePath` and `coldParkTerminalPanes` already are).
- **Deletions should outweigh additions.** The body being removed is ~349 lines; the replacement is
  a component call plus the re-homed behaviours.

## How we prove the UI is unchanged

The constraint is that this looks identical. Test it, do not assert it:

- Electron screenshots of the floating panel before and after, same profile and bounds: empty
  state, one terminal, several tabs, maximized, and with an editor and a browser tab open.
- Drag a tab to split and confirm both panes render — the bug that motivated this.
- Launch structured chat in the panel; confirm a real session (Orca-rendered chat, no
  chat/terminal toggle in the pane header, a `journal.db` under the workspace hash) rather than a
  terminal wearing a chat UI.
- Restart the app; confirm the session resumes in the panel.
- Confirm a floating launch still does not move the main window's active tab.

## Still open

**Where should a floating chat reopen after the floating folder is changed in Settings?** Today it
reopens wherever the setting now points, because the directory is looked up fresh each time. The
alternative is to record the directory the session actually ran in, check it still exists on
reopen, and fall back to the setting when it is gone. Recommended, and separable — it is host-side
and lands as its own commit that can be dropped independently of this work.
