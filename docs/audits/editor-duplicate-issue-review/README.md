# New editor resurrection reports

The refreshed issue search found [#21121](https://github.com/stablyai/orca/issues/21121) and [#21122](https://github.com/stablyai/orca/issues/21122), two open reports with identical bodies. They describe duplicate editor records and focus-derived ownership, with counts growing across persisted backups. This audit does not have that workstation's store.

Four bounded actual-source controls pass against this worktree:

1. Two clean records with the same document/owner and different live IDs serialize as two identical rows without those IDs.
2. Closing one seeded identity leaves the sibling record and its tab; selecting the remaining identity reactivates it.
3. `setActiveFile` accepts an ID with no backing file record.
4. Creating a unified editor tab for an explicitly local file can stamp it with the active workspace's remote execution host.

These are observed baseline behaviors, so the diagnostic assertions intentionally expect them. The first three use seeded records to isolate the retention/resurrection path; they do not establish every ordinary producer that minted those records. No file, shell, remote host or application window is opened. The four-case source hashes and result are in `results.json`.

```sh
ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run --config docs/audits/editor-duplicate-issue-review/config.mjs
```

Source review also confirms that restore deduplicates exact owner-qualified identities, while ordinary reconciliation removes tabs missing file records but does not symmetrically remove clean files missing tabs. The surface fallback can select any file in the workspace. `open-file-apply.ts` falls back to focused runtime settings when writable operation provenance cannot be captured, and skips that provenance path for read-only opens. Different runtime identities therefore remain distinct to its reuse lookup. These are code observations, not proof that every route in the report follows the same fallback.

## Existing fixes

Existing [#21124](https://github.com/stablyai/orca/pull/21124) addresses persistence deduplication, orphan records, same-document close and stale active-file selection. [#21125](https://github.com/stablyai/orca/pull/21125) includes that work and adds restore-time owner healing. Both were open at review; the latter targets main while carrying its predecessor's commits. Their authors report background application/restart checks against an isolated copy of the affected store. Those application results were not independently rerun here.

This audit records those existing proposals rather than publishing a duplicate fix. Their dirty-draft, read-only/live-tail, external SSH, unresolved owner and mixed-provider protections need to survive review. Remote unreachability does not establish that a process exited or a file disappeared. The metadata mechanisms explain a concrete duplicate/resurrection path; no measured bytes connect them to #19831 or #19768.
