# Local terminal close restored by the host membership fence

This audit reproduces a persistence mechanism consistent with [#17344](https://github.com/stablyai/orca/issues/17344): a local terminal tab closes in renderer state, yet remains in `orca-data.json` and returns on hydration. It does not establish that every tab in that report followed this path, or explain gigabytes of memory from the small persisted JSON alone.

## Run

From an installed checkout:

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/local-tab-close-rebase/reproduce.mjs /tmp/local-tab-close-rebase.json
```

The script uses the installed Vitest API, normal imports, a temporary config, and temporary data files. It launches no app windows or shell processes and changes no product files. The checked-in results record hashes of the relevant source files and fixture. The fixture intentionally asserts the current defect and its controls; it must be reviewed when the close contract changes.

## Actual owner path

The fixture drives the shipping renderer `createTab`, `closeTab`, session payload/patch builders, main `Store.setWorkspaceSession` / `patchWorkspaceSession`, disk flush/reload, and terminal-row hydration. The target starts as a real new tab with `ptyId: null`. Its sibling has a bound PTY; the normal exact-surface retirement transformation removes that sibling and advances the repository topology revision to 1. No native subprocess is required to exercise the persistence rule.

Closing the target sends no PTY kill or runtime terminal-close call because its retirement plan has no handles. The local renderer removes the target row and layout. Its next session patch reaches the main store, which rebases terminal membership against the prior host snapshot. Once the repository revision is positive, `rebaseWorkspaceSessionTerminalMembership` maps the **prior** tabs and reinstates the omitted target. Renderer snapshots cannot advance this revision: it is a host-private field.

The same condition can affect a restored, still-unbound row: hydration keeps valid rows without a competing canonical PTY owner. This proof does not infer any process's death from a missing diagnostics row, missing binding, or unreachable host. The target has never acquired a PTY.

## Controls and acknowledgement ordering

| Scenario                                                            | Renderer removes target | Disk/reloaded session retains target | Host close result |
| ------------------------------------------------------------------- | ----------------------- | ------------------------------------ | ----------------- |
| Revision 0, direct local close                                      | Yes                     | No                                   | No host request   |
| Sibling retirement establishes revision 1, direct local close       | Yes                     | **Yes**                              | No host request   |
| Explicit host membership retirement precedes renderer save          | Yes                     | No                                   | Authority control |
| Actual headless `closeMobileSessionTab(reason: user)`               | Yes                     | No                                   | `closed: true`    |
| Actual runtime close, renderer graph removal before acknowledgement | Yes                     | No                                   | `closed: true`    |
| Actual runtime close, renderer graph removal after acknowledgement  | Yes                     | **Yes**                              | `closed: true`    |

The last three cases use the actual runtime close method and durable Store. A narrow notifier fixture models the production acknowledged renderer-close callback: close the renderer tab, persist its session, acknowledge. It delivers the renderer's graph publication before or after that acknowledgement without using timing as the oracle. The IPC bridge awaits session persistence, but does not await graph publication. The graph scheduler normally coalesces changes for 16 ms and defers new work behind an in-flight publication.

The host already has a correct durable retirement primitive: `commitHeadlessTerminalTabRetirement` calls `closeTerminalTabInWorkspaceSession`, advances the topology revision, and flushes. However, the renderer-owned runtime-close path delegates to the renderer and only applies the headless fallback if its current graph no longer owns the parent. A late graph can therefore leave a successful close acknowledgement with the persisted row intact.

## Version and scope limits

The report names **v1.4.192**. Source inspection of that tag confirms the relevant null-PTY creation, local close routing, Store sanitization, prior-membership rebase, and save-before-ack callback. The runtime close branch exists in that tag's monolithic `src/main/runtime/orca-runtime.ts`; current code has it in `orca-runtime-close-mobile-session-tab.ts`. Executable cases run the current checkout, not the historical packaged Windows application.

The six cases use a local worktree identity and a registered repository; the Store reload is real. Folder workspaces and SSH hosts are not simulated. No remote cleanup or process termination policy changes are proposed by this artifact. Normal successful PTY exits, epoch-zero closes, explicit host retirement, and the headless API are negative controls.

## Fix boundary still under review

Do not treat renderer omission as close authority or weaken the rebase fence: it prevents stale saves from erasing host-created/live membership. An explicit local close must reach an ownership-aware host retirement transaction, including the no-PTY case. Any graph acknowledgement barrier must drain earlier publications, publish the current graph, and propagate failure. The existing scheduler is fire-and-forget; the internal publication function catches errors and resolves, so awaiting it directly is not such a barrier. A fixed delay cannot establish retirement.
