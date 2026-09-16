# Retained CI and terminal text tails

`sliceCheckLogTail` limits its returned text to 16 KiB, but a V8 sliced string can
keep the entire downloaded log alive. Long single lines and oversized earlier
error context reproduce this. The GitHub job-tail cache accepts 128 entries, with
downloads up to 64 MiB each; its logical tail cap therefore did not bound retained
backing storage. GitLab's raw-tail clamp can produce the same parent-retaining
slice before the shared excerpt function runs.

The fix reuses Orca's existing `flattenRetainedSlice` implementation, moving it to
shared code and preserving its renderer import through a re-export. The public
excerpt function copies its final, already-capped result. Content, Unicode,
earlier-error selection, cache count, and transport payloads stay identical.

The same defect exists at terminal retention boundaries. Session scrollback caps
and eager/pre-handler/shutdown queues keep 512 KiB tails of oversized strings,
but their byte ledgers miss the retained parent. The fix copies only truncated
tails, preserving the existing path for ordinary chunks. Persisted local
scrollback is already pruned; the session-buffer fix primarily covers remote or
not-yet-classified owners, while the queue fix covers local and remote output.

## Reproduce

```sh
ORCA_BACKGROUND_LAUNCH=1 node --expose-gc docs/audits/retained-text-slices/reproduce.mjs
```

The script bundles the actual shared GitHub/GitLab excerpt functions. Its baseline
removes only the three new copy boundaries in memory; production files are not changed. It retains
eight excerpts from distinct 2 MiB-character CI inputs, or eight 512 KiB
terminal tails from 4 MiB-character inputs, and measures heap after GC. A small regex operation clears V8's independent last-input reference. Bundle
hashes and all measurements are in [results.json](./results.json).

| Case | Returned bytes, all eight | Retained heap before | After |
| --- | ---: | ---: | ---: |
| GitHub long line | 131,072 | 16,774,216 | 143,160 |
| GitHub earlier Unicode error | 131,064 | 33,577,840 | 106,064 |
| GitLab long line | 131,072 | 16,793,640 | 147,488 |
| Persisted terminal buffers | 4,194,304 | 33,555,624 | 4,195,352 |
| Eager/pre-handler/shutdown tails | 4,194,304 | 33,556,040 | 4,195,600 |

Captured on macOS with Node v26.6.0. Heap samples include allocator/GC variation;
the order-of-magnitude separation is the relevant result. The focused six-suite
run passed 41 tests, including actual retained-heap checks, existing byte/content
contracts, GitLab normalization, and GitHub check-detail integration. A further
six-suite terminal run passed 69 tests, including actual shutdown queue storage,
scrollback ownership, pre-handler buffering, reattach, and UTF-8 boundaries.

The cap/slice path also exists in `v1.4.198`. Neither #19831 nor #19768 establishes
repeated CI-log viewing, so this is another demonstrated main-process retention
mechanism, not an attribution of either incident. Copying costs at most the final
16 KiB CI excerpt or truncated 512 KiB terminal tail and does not lower the
temporary allocation needed to download or parse the original input.
