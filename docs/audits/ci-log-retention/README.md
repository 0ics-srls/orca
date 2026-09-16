# Retained CI log excerpts

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

## Reproduce

```sh
ORCA_BACKGROUND_LAUNCH=1 node --expose-gc docs/audits/ci-log-retention/reproduce.mjs
```

The script bundles the actual shared GitHub/GitLab excerpt functions. Its baseline
removes only the final copy in memory; production files are not changed. It retains
eight excerpts from distinct two-million-character inputs and measures heap after
GC. A small regex operation clears V8's independent last-input reference. Bundle
hashes and all measurements are in [results.json](./results.json).

| Case | Returned bytes, all eight | Retained heap before | After |
| --- | ---: | ---: | ---: |
| GitHub long line | 131,072 | 16,772,392 | 131,416 |
| GitHub earlier Unicode error | 131,064 | 33,578,960 | 111,728 |
| GitLab long line | 131,072 | 16,793,680 | 148,248 |

Captured on macOS with Node v26.6.0. Heap samples include allocator/GC variation;
the order-of-magnitude separation is the relevant result. The focused six-suite
run passed 41 tests, including actual retained-heap checks, existing byte/content
contracts, GitLab normalization, and GitHub check-detail integration.

The cap/slice path also exists in `v1.4.198`. Neither #19831 nor #19768 establishes
repeated CI-log viewing, so this is another demonstrated main-process retention
mechanism, not an attribution of either incident. Copying costs at most the final
16 KiB excerpt per call and does not lower the temporary allocation needed to
download or parse the original log.
