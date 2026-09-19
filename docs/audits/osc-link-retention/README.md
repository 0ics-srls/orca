# OSC 8 hyperlink retention reproduction

The installed xterm builds retain hyperlink metadata after a TUI overwrites its
linked text. Each anonymous OSC 8 open creates a registry entry and a line marker;
overwriting or erasing that line's cells does not dispose the marker. Repainting
one linked character therefore grows memory indefinitely even with 24 buffer rows.

This reproduces in `@xterm/headless@6.1.0-beta.302` and
`@xterm/xterm@6.1.0-beta.303`, the versions also shipped in `v1.4.198`.
`OscLinkService.registerLink`, `Buffer.addMarker`, and marker-disposal callbacks
form the retaining path. Explicit `id=` values reuse entries only while both the
ID and URI stay identical; fresh IDs or URIs can accumulate the same way.

## Run

From the repository root, with dependencies installed:

```sh
ORCA_BACKGROUND_LAUNCH=1 node --expose-gc docs/audits/osc-link-retention/reproduce.mjs
```

The script bundles the current collector, records its SHA-256, and compares the
same installed xterm with and without collection. It uses real parsers and forced
GC without opening a window. Every case performs 10,000 redraws, sampling every
2,500; modes cover ordinary overwrite, erase-line, and alternate-screen redraws.

## Recorded result

See [results.json](./results.json), captured on macOS with Node v26.6.0. Values
below are heap growth after GC, in decimal MB; these are isolated reproductions,
not affected-host measurements.

| Terminal | Before, across three modes | After, across three modes |
| -------- | -------------------------: | ------------------------: |
| Headless |             20.59–20.93 MB |              1.65–1.72 MB |
| Renderer |             20.52–20.76 MB |              1.66–1.71 MB |

All baseline cases retained 10,000 entries/markers with only 24 rows. All fixed
cases retained 785 entries/markers at the final sample. A sweep of a 5,024-row, 160-column buffer removed 1,024 obsolete entries in
roughly 6–14 ms for plain rows and 14–16 ms for link-dense rows in the refreshed
run. At 50,024 rows, plain sweeps measured roughly 45–51 ms and link-dense sweeps
roughly 263–325 ms. Sweep cost
scales with configured buffer size; these are isolated samples, not latency bounds.

## Fix and safeguards

After 1,024 additional registry entries, the collector scans both normal and
alternate buffers and preserves every referenced URL ID, the currently open link,
and saved-cursor attributes. It disposes only markers belonging to entries with
no remaining reference. Existing xterm callbacks remove both registry indexes;
unrelated markers are untouched. The check runs after headless parsing and through
`onWriteParsed` for desktop panes, dashboard previews, and the mobile WebView.

The scan deliberately checks every cell instead of trusting marker rows: wrapping
can put live linked cells on a row other than the initial marker, and resize/reflow
can make marker coordinates stale. Regression tests exercise real headless/renderer
libraries, the generated mobile engine, scrollback, alternate-screen transitions,
partial overwrite/reflow, explicit ID reuse, split writes, unrelated markers, and
both production headless write paths. This keeps correctness sound but leaves a
known performance gap for very large, link-dense scrollback: a synchronous sweep
can take hundreds of milliseconds. A future time-budgeted or incremental collector
should address that separately; this PR does not claim to remove that stall.

The collector depends on private xterm registry/attribute fields, as Orca's
existing snapshot hyperlink extraction does. Shape checks skip unsupported core
layouts, and tests against the pinned libraries must accompany upgrades. Cleanup
occurs between parsed batches; it does not cap a single batch's allocation, live
hyperlink bytes, or ordinary scrollback. Without further registry growth, a final
tail of obsolete entries can remain until terminal disposal.

## Issue correlation

This mechanism can retain memory in Electron main's terminal mirrors, terminal
daemons, and rendered terminals. It needs neither SSH nor headless automation and
is compatible with prolonged TUI redraws. It is therefore a concrete candidate
for [#19831](https://github.com/stablyai/orca/issues/19831) and the main-process
growth in [#19768](https://github.com/stablyai/orca/issues/19768). Neither report
contains the relevant output transcript or allocation trace; this reproduction
does not establish either incident's root cause or measured growth rate.
