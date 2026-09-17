# Closed editor model lifetime

Closing the final editor, or closing a file while every editor panel is hidden, can leave its Monaco text model registered for the renderer's remaining lifetime. The old cleanup hook lived in the conditionally mounted `EditorPanel`: it disappeared before observing the final close and missed closes while absent. `MonacoEditor` uses `keepCurrentModel`, so unmounting the widget does not provide the missing cleanup.

The fix subscribes from the app shell and lazily receives the model registry from the existing `monaco-setup` load. It retires only closed tab owners. It preserves live same-URI editors, replacement model objects, generated diff namespaces, attached models until detachment, and caches written by a reopened owner during a disposal callback. Cold rich/preview/PDF caches are cleaned without loading Monaco. No tab, dirty draft, or retained live editor history is pruned.

## Measured result

| Actual source control                        | Before                                                                 | Fixed                                       |
| -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| Eight distinct last-file closes              | 8 registered closed models; 2,097,208 logical characters; 0 open files | 0 registered models; 0 open files           |
| Close with another editor still mounted      | Closed model disposed; sibling preserved                               | Same                                        |
| Close while hidden, then open another editor | Old closed model remains; 2 models for 1 open file                     | Old model disposed; 1 model for 1 open file |
| Normal terminal/editor switch                | Original open model preserved                                          | Same                                        |

All four controls pass with their stated before/fixed expectations on both graphs and both runtimes: **32 comparative cases**, Node 26.6.0 and Electron 43.7.0 / Node 24.21.0. Reports are `worktree-*-results.json` and `main-*-results.json`. Contents use eight distinct fixture paths and 256 KiB of logical characters per model; this is a controlled amplification, not a field file-size measurement or heap-byte estimate.

This explains a concrete renderer retention mechanism relevant to [#12845](https://github.com/stablyai/orca/issues/12845). The same conditional panel, hook placement, and `keepCurrentModel` chain exists in reported v1.4.170; `source-versions.json` records four historical source hashes and matching line numbers. That comparison is static, not an execution of the historical application. It does not establish which allocations caused #12845's reported heap, or the process and cause of [#19831](https://github.com/stablyai/orca/issues/19831).

## Ownership and regression coverage

The 17 permanent cases in `closed-editor-model-{lifetime,reentrancy,registry,shell}.test.*` use actual installed Monaco text models and full test-store close actions. They cover final/hidden panel closure, live siblings and canonical shared URIs, model replacement, real attachment events and post-stack disposal, URI reopening, HMR successor registration, generated diff prefixes, reentrant model/cache ownership, cold caches, terminal subtree remount, and zero global registry enumeration for ordinary edit closes. Together with the three existing disposal/cache suites, **37 tests pass**. The fixture invokes Monaco's real model attachment/detachment ports; it does not create a native editor widget.

Independent review additionally exercised controller teardown, registry replacement, reentrant teardown/replacement, a 24-diff `closeAllFiles` batch, and live metadata updates: six cases in each runtime. Both retained event listeners were disposed once, old callback authority was cancelled, the 48-model diff batch enumerated the registry once, and 32 live metadata changes performed no global scan. These are recorded review results; the self-contained comparative runner here contains the four tabled controls.

The controller remembers minimal closed-owner descriptors and exact model identities for the current microtask. Attached closed models retain those descriptors until detachment/disposal or owner teardown. This retained custody is intentional. It does not reconcile unrelated preexisting Monaco models or erase separate cache lifetimes without a closed-tab transition.

## Source fences and independent main publication

`source-versions.json` fences **1,021 repository paths**: the complete loaded repository graph of the comparative proof plus selected static wiring/caller files. Vite rejects any additional repository module under `src/` or `config/`. Package code is not part of that repository-graph claim: twelve separate dependency hashes pin the installed package metadata and relevant Monaco model/registry/event and Zustand store implementations.

- Worktree baseline: `f142544a8653eedab2eec0237a9005001497b2f5`.
- Publication main: `291b4ddd6f1c1af480169885e0fda7f9c78ff053`.
- `fix.patch` contains only the eight product changes, including two new modules. The loader reverses it from the checked-out fixed sources to reconstruct baseline behavior.
- `main-context.patch` reconstructs 22 unrelated context differences, including two paths absent on main. It is proof scaffolding; do not apply it as a product patch.
- Main retains its unrelated `registerShellMarkdownAliases` import/call in `monaco-setup.ts`. The standalone product patch preserves both lines.
- The loader checks each before/fixed hash, refuses source/dependency drift, normalizes CRLF to LF, and supports both the working checkout and an independently published main checkout. `loader-results.json` records synthetic CRLF and simulated-main-checkout controls for all four graph/variant combinations.

The comparative test executes the actual legacy surface, old/new cleanup hook, disposal functions, store close action and model registry. It supplies controlled Panel/Shell ports and a fixture store to the hook. Actual app-shell placement, first lazy registration, conditional panel callers and `keepCurrentModel` wiring are source-fenced static checks; it does not render the entire application or exercise HMR through Vite itself. It opens no Electron window, starts no native editor widget, and measures no RSS, heap bytes, or incident allocation rate.

## Reproduce

From the repository root with its installed dependencies:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config docs/audits/closed-editor-model-lifetime/vitest.config.mjs
node docs/audits/closed-editor-model-lifetime/loader-controls.cjs
```

The default is `ORCA_CLOSED_MODEL_GRAPH=worktree` and `ORCA_CLOSED_MODEL_VARIANT=fixed`. Repeat with each graph (`worktree`, `main`) and variant (`before`, `fixed`). Set these environment variables using the syntax of your shell; the runner and path handling are platform-neutral. Set `ORCA_CLOSED_MODEL_OUTPUT` or `ORCA_CLOSED_MODEL_LOADER_OUTPUT` to an output path to avoid replacing checked-in reports.

For Electron, run the installed Electron binary with `ELECTRON_RUN_AS_NODE=1`, `ORCA_BACKGROUND_LAUNCH=1`, `--no-experimental-webstorage --expose-gc`, followed by `node_modules/vitest/vitest.mjs run --config docs/audits/closed-editor-model-lifetime/vitest.config.mjs` and the same graph/variant environment. This uses Electron's Node runtime without creating a window.
