# #18224: renderer create with no renderable workspace

## Result

The current source has a conditional retained-state mechanism: an accepted renderer-backed create adds a tab, a unified row and a startup command, then the ten-second handle wait fails without retiring those owners. Eight repeated focused creates retain eight of each; eight background creates do likewise. Sixty additional seconds on the fixture clock do not change the counts. The wait callback and IPC reply listener are released. Explicit tab close removes the rows and queued commands.

There is an ordinary producer for the missing surface. `worktrees:listAll` applies the external-worktree visibility policy, while the runtime launch resolver accepts the same Git row without applying that UI policy. With external worktrees hidden, actual catalog listing returns no row, actual scoped launch resolution succeeds, and actual focused create times out. A later authoritative detected-worktree refresh still retains the failed tab/intent: the checkout exists in the result with `visible:false`, so it is not an authoritative removal. Changing the visibility policy to show produces a surface with the same pending command still present.

This explains a reachable conditional failure shape in [#18224](https://github.com/stablyai/orca/issues/18224). It does not establish the reporter's exact source of missing local catalog rows or an OOM incident. This proof measures store cardinality, not heap/RSS or physical process creation.

## Report correction and existing work

- The report says arbitrary local `id:` metadata can synthesize an unlisted worktree. Exact v1.4.191, reported v1.4.194 and named main291b all require `repo.connectionId` for that fallback. The current negative control refuses stale local metadata with `selector_not_found`. The SSH fallback control does reach the renderer and timeout. Main/renderer catalog disagreement is independently reachable through visibility policy; it does not require the report's overbroad local fallback claim.
- Root verified [PR #18290](https://github.com/stablyai/orca/pull/18290) remains open at `89dba250fa436c35dc83ccd0f0af082cc6237c22`; the cached PR comment describes a background pre-admission guard. Its guard is absent from the current bridge. Do not duplicate that background fix. Focused-create ownership is the separate remaining design question.
- The startup-command retention suite intentionally preserves commands across remount and sibling binding, and releases on successful consumption or explicit close. These semantics are necessary for late real mounts. A handle timeout is not an explicit close request and does not establish physical absence.
- Existing pending split/tab close fixes carry an explicit user-close intention through an in-flight spawn. This case has no close intention and can have no mounted pane or spawn at all. Those fixes do not retire these rows automatically.

## Actual chain exercised

1. Actual CLI command classification recognizes `/not-installed/claude` as interactive. The CLI executable and network transport are not launched.
2. Actual `terminal.create` RPC handler and `dedupeTerminalCreate` accept local CLI-shaped params without a mutation ID; the no-ID branch calls the actual `createTerminal` path. A live renderer plus `rendererBacked:true` selects `createDesktopTerminal`.
3. Actual scoped row resolver, selector and terminal workspace launch scope accept a finite successful Git result. The Git adapter is injected; no Git subprocess or native filesystem probe runs. Local metadata-only refusal and SSH metadata fallback are separate controls.
4. Actual `worktrees:listAll`, detected-row classifier and renderer `mergeFetchedWorktrees` implement the visibility and refresh control. A finite injected scan supplies the identical Git rows to both producer paths. There is no injected native stall.
5. Actual IPC create bridge, routing, activation actions, tab creation, startup queue, close and consume actions operate on the existing full test store. IPC delivery is an in-memory loop with sender/request identity preserved.
6. Actual `waitForTerminalHandle` runs with fake timers; only handle lookup is supplied by the fixture. Actual workspace surface projection stays empty until a catalog row is admitted. React terminal panes, xterm and native providers are never mounted or launched.

UI focus functions are inert stubs, as are feature telemetry and GitHub refresh. Ancestor runtime classes are replaced with empty bases so unrelated service initialization does not run. The relevant runtime methods are imported from the actual modules and connected to the same fixture owner. The ordinary-success control supplies a handle publication; it does not simulate native exit or claim a physical PTY was created. The late-catalog control proves the existing queued command becomes eligible and can be consumed, not that this test mounted a real pane.

## Eight controls

| Control                                                  | Observed boundary                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Eight focused missing-surface creates                    | Eight tabs/unified rows/startup intents; zero surfaces/waiters/reply listeners after timeout; explicit close releases all |
| Eight background missing-surface creates                 | Same result in current source; upstream background guard remains separate                                                 |
| Catalog arrives after timeout                            | Same pending command survives and surface becomes eligible; normal consume releases it                                    |
| Handle published before deadline                         | Create succeeds and waiter/listener clean up                                                                              |
| Unknown renderer repo                                    | Refused before any row or command is created                                                                              |
| Stale local metadata without a main scan row             | Actual selector refuses before renderer creation                                                                          |
| Saved SSH metadata with no scan row                      | Actual fallback reaches renderer; no surface means timeout and retained row                                               |
| External visibility hide/show plus authoritative refresh | Real successful Git row is launchable but hidden; refresh retains failed row; show exposes its existing command           |

## Source/version boundary

`source-versions.json` records 35 selected current paths and 105 named path identities across main291b (`291b4ddd6f1c1af480169885e0fda7f9c78ff053`), v1.4.194 (`5d709e45f6b0ba51d62c5b81870895be65c60177`) and v1.4.191 (`6b48a370d9d363f3b7d997573eaef5490381a946`). Null means the split file did not yet exist. Historical runtime methods were read from the exact monolithic Git objects. The handle-wait signature/body is byte-identical after excluding the private/protected modifier. The SSH-only metadata fallback is present in all four contexts. Visibility policy modules also match v194; other changed files are recorded without claiming whole-module identity.

The main291b test config substitutes these 35 explicitly named source paths in memory, checking their hashes against Git-derived `main-sources.json`. Other dependencies remain current. This is a named boundary overlay, not execution of the whole historical release. v191/v194 evidence is static source comparison, not a historical runtime rerun. The config checks all current source hashes and every selected main source before imports.

Reports: `working-node-results.json`, `main-node-results.json`, `working-electron-results.json`, `main-electron-results.json`. Each final report must contain eight passing tests. Electron runs only as Node with `ORCA_BACKGROUND_LAUNCH=1` and `ELECTRON_RUN_AS_NODE=1`; no app or window is started.

## Safe design question

No product edit is proposed for publication yet. A focused request must establish a renderable, correctly owned workspace before it allocates a launch intent, or acquire an exact pending-intent ownership token whose retirement cannot race a real late mount. Reusing the existing workspace/catalog activation authority is preferable to treating a timeout as permission to kill a provider or close a same-ID replacement. Simply deleting `pendingStartupByTabId` at ten seconds loses valid late commands, and deleting a tab after timeout can race a native spawn that already committed. A blanket focused renderability rejection would also change legitimate activation during catalog hydration; that tradeoff needs explicit design review.

## Re-run from the repository root

```sh
ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run --config docs/audits/hidden-worktree-terminal-create/config.mjs
ORCA_BACKGROUND_LAUNCH=1 ORCA_ISSUE18224_SOURCE=main291b node node_modules/vitest/vitest.mjs run --config docs/audits/hidden-worktree-terminal-create/config.mjs
```

The parent reviewer independently reran both Node variants: eight controls pass in each. Stored reports were captured before this artifact relocation; relocated controls are rerun separately and recorded in `manifest.json`.
