# Expanded issue search and relay version stranding

The expanded title search adds `heap`, `RSS` and `swap` to the original six
terms. One batched query returned 66 distinct open reports; all nine searches
fit a complete first page below 100 results. The issue index keeps 67 catalog
rows because previously matched #9141 is now closed. This is search coverage,
not a claim that every memory-related issue uses those words in its title.

Six newly indexed reports and all their available comments were read:

| Issue                                                   | Result                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#10382](https://github.com/stablyai/orca/issues/10382) | macOS renderer exit-code-5 with low last reported JS heap in one cohort. [Historical telemetry and recovery controls](../renderer-exit5-telemetry/README.md) explain the diagnostic limits and repeated reloads; no incident root cause established. |
| [#13852](https://github.com/stablyai/orca/issues/13852) | A relay build change moves the endpoint and prevents cross-build attach. Existing discovery retains live old owners.                                                                                                                                 |
| [#1355](https://github.com/stablyai/orca/issues/1355)   | Sidebar-side swap is a layout request.                                                                                                                                                                                                               |
| [#11824](https://github.com/stablyai/orca/issues/11824) | WSL account profile swapping loses settings; configuration identity.                                                                                                                                                                                 |
| [#13171](https://github.com/stablyai/orca/issues/13171) | App archive replacement invalidates lazy chunk reads. The issue's archive-crash reproduction was not independently rerun in this audit and does not establish retained memory.                                                                       |
| [#16703](https://github.com/stablyai/orca/issues/16703) | Windows agent icons swap identity; status presentation.                                                                                                                                                                                              |

## Why #13852 strands sessions

`readLocalFullVersion` reads the relay's content-hashed build version.
`computeRemoteRelayDir` puts that version into the install directory;
`ssh-relay-deploy.ts` derives the endpoint from that directory.
The current handshake separately rejects a different version. The existing
cross-version isolation test explicitly asserts that deploying v2 never touches
v1's directory or socket. These properties explain why an updated client cannot
adopt old relay-backed terminals through the current attach route.

The old relay can still own live PTYs. Current install GC preserves directories
whose liveness probe is positive or inconclusive. Current superseded-endpoint
discovery does not grant authority to kill a live owner merely because the new
client cannot reattach. Remote terminal state stays `unverifiable` when the
execution host cannot answer. The distinction prevents memory cleanup from
destroying running remote work.

A [field comment](https://github.com/stablyai/orca/issues/13852#issuecomment-5493610344)
reports 11 version directories, 11 sockets and 19 relay processes with 839 MB
combined RSS, oldest 6.7 days. These are the commenter's measurements; this audit
did not access that host. The source explains stranded owners, but does not
identify every reported process or independently measure those bytes.

The [latest status comment](https://github.com/stablyai/orca/issues/13852#issuecomment-5523691997)
correctly distinguishes documentation from a repair: #17972 records the boundary,
while cross-version adoption is still absent. The cold-restore path can resume
an agent only when suitable resumable session state was captured. Source alone
does not identify which missing condition produced a particular bare shell.

Moving an endpoint is not a safe isolated memory fix. Protocol compatibility,
incumbent discovery and install-GC ownership must be designed together, including
older installed relays and Windows pipe liveness markers. No relay shutdown,
endpoint or wire behavior was changed in this audit follow-up.

## Validation and limits

Seven existing tests pass across cross-version deploy isolation and real local
socket handshake round trips. They verify matching-version success, mismatched
version refusal and credential handling. They create temporary local sockets;
they do not connect to a user's host or launch an application window.

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config config/vitest.config.ts src/main/ssh/ssh-relay-cross-version-isolation.test.ts src/relay/relay-handshake-roundtrip.test.ts
```

`source-hashes.json` records reviewed code, test and boundary-document hashes,
query counts and source-comment provenance. The current implementation was
checked directly; historical comment line numbers are not substituted for
current source. This remote mechanism does not explain the all-local workload
reported in #19831.
