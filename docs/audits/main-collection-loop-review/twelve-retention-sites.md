# Twelve additional progress and retention checks

This follow-up records the selected source reads below. Some overlap earlier area audits. They narrow loop-progress and lifetime questions; they do not clear the whole mechanical candidate list or identify an incident allocator. Exact source hashes are in [the manifest](./twelve-retention-sites.json).

1. **`src/shared/agent-hook-status-cache.ts`** — Eviction deletes an actual non-current pane through clearPaneCacheState or breaks. Positive safe-integer maxPanes defaults to 500. The cleanup removes pane-scoped status and companion caches. This is a count bound, not a byte bound on arbitrary admitted payloads.

2. **`src/shared/remote-runtime-shared-control-retired-request-ids.ts`** — Each count-prune deletes the oldest actual key; expiry traversal only deletes. The production connection uses defaults of 2,048 IDs and 60 seconds. Non-finite custom constructor values are not validated, but no production custom values were found. String bytes remain separate from count.

3. **`src/main/plugins/plugin-worker-output-buffer.ts`** — Each loop consumes through a newline or returns. The stream retains at most 8,192 code units of unfinished text, discards an overflowing line until newline, and clears on end. Listener lifetime belongs to child stdout/stderr. Slices/concatenations require a separate backing-storage check; logical length is not proof of owned bytes.

4. **`src/shared/raster-image-base64-preview.ts`** — Probe grows geometrically from 64 bytes by 16x, capped at 8 MiB. Exhausted input returns; over-limit dimensions trigger one final maximum probe whose exhausted branch returns. Decode scans finite input and allocates at most the probe size. The caller's encoded content already exists; this is not a whole-image memory bound.

5. **`src/main/pty/legacy-terminal-shim-dir.ts`** — Literal PATH removal advances searchStart after a non-boundary match, or shortens result by removing the matched nonempty entry/boundary. Production entries come from nonempty explicit shim directories and their path spellings. Case folding and repeated concatenation are input-sized transient work.

6. **`src/shared/terminal-title-wrapper-segments.ts`** — Separator search advances by the positive-width separator each time. Returned suffix count grows with title length; includes checks can make repeated-wrapper input expensive and suffixes can share backing storage. These are local results used by title identity/status checks; no persistent growing collection in this function.

7. **`src/shared/terminal-query-reply.ts`** — Both extraction loops accept only a nonempty anchored reply match, advance to its end, or return null. Returned reply strings and arrays scale with input and can share backing storage. This review does not impose a byte limit on callers or change protocol recognition.

8. **`src/shared/runtime-rpc-error-code.ts`** — Cause-chain traversal records each object in a visited Set and stops on a repeated identity, primitive, or matching token. Work scales with a finite chain; arbitrary user-defined property getters are outside the plain transported error-object case.

9. **`src/shared/retired-pty-incarnations.ts`** — Expiry traversal only deletes, and count-prune deletes oldest entries until at most 1,000. Some callers prune before adding one new entry, so 1,000 is not asserted as a universal post-insertion maximum. Evidence strings are caller-sized; expiry admission is reviewed separately from process authority.

10. **`src/shared/search-subprocess-lines.ts`** — Each delimiter loop advances to newline+1 or returns. Buffer growth checks the configured line budget first, copies residual bytes and drops its buffer after emitting a line. Default line cap is 64 MiB; complete string fast-path is conservatively bounded by 3 * UTF-16 units. Input conversion and callback retention remain separate.

11. **`src/shared/main-process-ndjson-framer.ts`** — Prefix binary search narrows its integer interval; main parser advances before callbacks or returns while retaining suffix/paused input. Default limits are 16 MiB per line and 64 MiB paused complete queue. The production Codex reader explicitly passes Infinity to preserve provider payload fidelity, so those defaults do not bound that caller; stdout.pause/resume supplies transport backpressure. No safe truncation policy is inferred.

12. **`src/shared/terminal-kitty-keyboard-mode-tracker.ts`** — The global regexp cannot match empty input; pop stops once its stack of at most 16 frames empties. An incomplete escape suffix is logically capped at 4,096 units but returned with slice from the full input. A separate actual-source Node/Electron backing-string investigation is pending; bounded suffix length alone is not leak-free evidence.

The separate Windows ancestor walk was revisited against its caller: it consumes the shared descendant projection already covered by existing PR #20715. No duplicate defensive patch is proposed from this read. Native getters, raw input acquisition, and the behavior of supplied callbacks remain explicit boundaries to these source-level observations.
