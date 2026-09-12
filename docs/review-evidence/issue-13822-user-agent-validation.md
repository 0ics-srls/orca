# Issue 13822 user-agent validation

Validated on macOS against `origin/main` `b35791365427f097c134d7d856f31053f8aa399a` on
2026-09-12. All Electron launches used `ORCA_BACKGROUND_LAUNCH=1`, hidden windows, a fresh
user-data directory, and browser-level CDP auto-attach before the startup barrier was released.
Final wire headers came from `Network.requestWillBeSentExtraInfo`; local server receipts were the
wire backstop and the WebSocket/shared-worker oracle where CDP does not expose a request event.
The final live rerun used this final executable source tree; the following amendment changes only
this evidence document.

## Result

The default CLEAN identity has one process owner. Startup captures the raw Electron/Orca identity,
cleans only the application and Electron tokens, and assigns `app.userAgentFallback` before
readiness or Chromium object construction. CLEAN sessions no longer set a base session identity or
rewrite ordinary traffic in `webRequest`.

The surviving request policy is exception-only: HTTPS Google authentication and the mobile preset.
It covers HTTP, HTTPS, WS, and WSS, returns ordinary headers without modification, and has an
idempotent disposer used by partition teardown and CLEAN-to-NATIVE transition. An unmapped numeric
`webContentsId` is treated as popup/WebContents traffic, not as an unattributed worker.

NATIVE implements option B1. Documents, frames, and blob-frame requests stamped by their owning
WebContents use the captured raw identity. Service/shared-worker JavaScript, worker-stamped
requests, and network fill-in for a request with no UA deterministically use CLEAN. There is no
NATIVE `Session.setUserAgent` call and no NATIVE request correction.

## Eight acceptance gates

### 1. Startup and process fallback

- Controlled Electron CLEAN arm: 10/10 cold launches passed.
- Every launch observed the exact ordering `fallback`, `ready`, `session`, `webContents`.
- Every launch preserved the cleaned fallback after the post-ready `app.setName` change.
- Every launch covered both the default and an isolated Session, and both a default-partition and
  isolated-partition hidden BrowserWindow.
- Unit ordering/startup coverage: 4 files, 9/9 tests passed in the final focused UI/startup batch.
- Late-fallback red control: 10/10 launches found both raw and CLEAN wire identities even after
  restoring `Session.setUserAgent(clean)`. No run was incorrectly rescued by the session setter.

### 2. Default CLEAN on Cloudflare login

The live arms were interleaved by repetition and used a fresh profile each time.

| Arm                   | Repetition request counts | One distinct UA | Native leaks | Literal verification failures |
| --------------------- | ------------------------- | --------------: | -----------: | ----------------------------: |
| Branch                | 90, 91, 90, 90, 90        |             5/5 |            0 |                           0/5 |
| `origin/main` control | 99, 99, 99, 99, 99        |             3/5 |            6 |                           5/5 |

Branch resource counts across the five runs, with exactly one CLEAN UA in every bucket:

| Resource type | Requests | Native leaks |
| ------------- | -------: | -----------: |
| Document      |       10 |            0 |
| Script        |      249 |            0 |
| Font          |       15 |            0 |
| Stylesheet    |        5 |            0 |
| XHR           |       30 |            0 |
| Fetch         |      107 |            0 |
| Other         |       30 |            0 |
| Ping          |        5 |            0 |
| **Total**     |  **451** |        **0** |

`origin/main` produced six raw service-worker Fetches across repetitions 1 and 4. The page's literal
Turnstile failure marker appeared in all five control runs and in zero branch runs.

### 3. Blob frames, service workers, and shared workers

- CLEAN controlled arm: 10/10 launches covered 20 required routes and 6 JavaScript contexts.
- Per CLEAN launch, the blob iframe reported CLEAN JavaScript and produced all 3 named routes:
  blob fetch, XHR, and image. All 30/30 named blob routes across the repetitions were CLEAN.
- Per CLEAN launch, the shared worker reported CLEAN JavaScript and produced both named server
  routes. All 20/20 named shared-worker routes across the repetitions were CLEAN.
- Per CLEAN launch, the service worker reported CLEAN JavaScript and produced its named Fetch.
  All 10/10 named service-worker routes were CLEAN.
- The CDP collector attached to a `shared_worker` target in 10/10 CLEAN launches and observed the
  named blob fetch through CDP in 10/10.
- NATIVE B1 arm: 10/10 launches kept blob document JavaScript and its Blink-stamped fetch raw while
  shared/service-worker JavaScript and named worker routes remained CLEAN.

Shared-worker server receipts are authoritative wire observations. Chromium did not consistently
publish shared-worker fetches as CDP Network events, so the report does not claim CDP request-event
coverage for those two routes.

### 4. Google authentication exception

The final live comparison produced 25/25 Firefox-shaped requests in each arm and zero CLEAN requests
inside the auth flow. The branch document's `navigator.userAgent` was Firefox-shaped.

| Host                   | Branch requests | Firefox requests |
| ---------------------- | --------------: | ---------------: |
| `accounts.google.com`  |               7 |                7 |
| `www.gstatic.com`      |              12 |               12 |
| `fonts.gstatic.com`    |               1 |                1 |
| `accounts.youtube.com` |               1 |                1 |
| `play.google.com`      |               4 |                4 |
| **Total**              |          **25** |           **25** |

Deterministic tests additionally cover the HTTPS-only host predicate, Firefox client-hint removal,
auth subresources, direct navigation, server redirects, post-auth main-frame exit, mobile restore,
NATIVE opt-out, shared debugger leases, and no replayed/cancelled navigation path.

### 5. Mobile, popup, HTTP, and WebSocket policy

- Mobile controlled arm: 10/10 launches passed. Each covered HTTP document/blob/worker requests,
  one `ws` handshake, and one `wss` handshake with the mobile identity.
- Popup coverage: 10/10 mobile launches gave the unmapped numeric popup CLEAN wire and JavaScript
  identity, while its opener remained mobile.
- Mixed shared-session arm: 10/10 launches kept the desktop peer's page and wire CLEAN, kept the
  mobile page mobile, applied the active session-scoped mobile identity to both unattributed
  shared-worker routes, and recorded CLEAN worker JavaScript twice per launch.
- Across the repeated controlled run, the mobile, mixed-mobile, and late-fallback arms each covered
  all 20 named HTTP/HTTPS/WS/WSS routes in 10/10 launches.

The mixed-session result is the deliberate session-scoped mobile limitation: worker JavaScript is
process CLEAN while unattributed worker wire traffic is mobile as long as a mobile lease is active.
It is asserted instead of being inferred from a failed tab lookup.

### 6. NATIVE B1 creation doors and precedence

- NATIVE controlled arm: 10/10 launches passed.
- In all 10 runs, document and blob JavaScript plus their Blink-stamped requests were raw; shared
  and service worker JavaScript/requests and explicit no-UA fill-in were CLEAN.
- Unit coverage verifies NATIVE precedes mobile/auth policy, offscreen registration applies raw
  identity before navigation, local registrations resolve the Session's effective mode, and the
  renderer waits for main's identity-ready acknowledgment before assigning the first webview URL.
- WebContentsView popup preparation, offscreen/agent registration, renderer guests, and
  client-hosted guests all share the pre-navigation identity path.
- UI, CLI help, translations, and profile documentation now disclose the page/worker split rather
  than describing NATIVE as universally unmodified.

### 7. Session lifecycle, teardown, and persistence

- Unit tests assert ordinary request header object/value preservation and zero base rewrite.
- Unit tests assert exception-listener disposal exactly once during general cleanup and before a
  CLEAN Session is marked NATIVE.
- Profile deletion retires the UA exception separately while retaining the fail-closed security
  policy for a still-live deleted-profile guest.
- Reinstallation replaces the prior listener instead of stacking it; partition state rejects an
  incompatible live route-mode reuse.
- Persisted profile tests cover CLEAN fallback inheritance, ignored legacy stored UAs, NATIVE mode
  retention, default-policy restore, and repeated restore without stacked handlers.

### 8. Client-hosted routes and mixed versions

- The authoritative mode is carried through attach, inventory, create, reclaim, restore,
  reconciliation, persistence, and recovery before the execution client materializes a Session.
- Focused protocol/registry/recovery batch: 7 files, 146/146 tests passed.
- The protocol tests prove the mode is additive to old decoders, is valid only with command and
  inventory v1 negotiation, and is mandatory on negotiated inventory/profile commands.
- A capable execution client rejects mode-omitting create/reclaim/restore with
  `browser_client_user_agent_contract_required`; it does not infer from its unrelated local profile
  registry or coerce NATIVE to CLEAN.
- Explicit placement on an incapable client fails before page placement/publication. Persisted
  client-hosted pages remain unavailable until a capable client reconnects. Ordinary local
  renderer and offscreen creation are unaffected.

## Regression validation

| Gate                                             | Result                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Changed-code lint, type-aware lint, React Doctor | 0 new findings across 129 changed files                                                           |
| Typecheck                                        | passed                                                                                            |
| Main browser suite                               | 185 files passed, 1 skipped; 1,724 tests passed, 2 skipped                                        |
| Client protocol/registry/recovery focus          | 7 files passed; 146 tests passed                                                                  |
| Electron controlled identity fixture             | 50/50 arm launches passed: 10 each CLEAN, late-fallback red control, mobile, mixed-mobile, NATIVE |
| Live Electron compatibility fixture              | 2/2 tests passed; 10 Cloudflare launches plus 2 Google arms                                       |
| Runtime/shared/renderer/CLI batch                | 5,315 files passed, 11 skipped; 48,099 tests passed, 154 skipped; 5 base-suite tests failed       |

The five broad-batch failures are all in
`src/renderer/src/components/tab-bar/TabBar.context-menu.test.ts`. A targeted rerun reproduced 5
failures and 6 passes. Neither that test nor the tab-bar implementation has a branch diff against
`origin/main`; the four changed renderer/startup/protocol focused files passed 9/9. This is recorded
as a base-suite failure, not hidden or counted as a pass.

## Red ablations and green controls

- Moving/omitting the process fallback while restoring the Session setter: 10/10 red runs exposed
  both raw and CLEAN wire identities.
- `origin/main` live control: 5/5 literal Cloudflare verification failures; two runs exposed six raw
  service-worker Fetches in total.
- Ordinary CLEAN request policy: exact input header object and values remain unchanged.
- HTTP Google lookalike: stays non-Firefox; the HTTPS auth host becomes Firefox and loses all
  `sec-ch-ua*` hints.
- Unattributed-worker resolver ablation: changes the asserted mobile worker route, proving that the
  exception hook rather than the process base owns that route.
- Numeric popup regression control: using popup ownership keeps wire/JS CLEAN while the opener is
  mobile.
- Contract omission controls: negotiated page inventory and create/reclaim/restore commands fail
  validation/admission instead of selecting a local or default mode.
- Listener lifecycle controls: general teardown and CLEAN-to-NATIVE each dispose once; reinstallation
  cannot accumulate another active listener.

## Diff decomposition and separability

The following mutually exclusive review decomposition assigns every implementation file to its
primary responsibility. Counts are against the base above and exclude this evidence file.

| Area                                                  |   Files |     Added | Removed |
| ----------------------------------------------------- | ------: | --------: | ------: |
| (a) Process-default core and local base ownership     |       6 |        76 |      16 |
| (b) Removal/replacement of per-request base machinery |       9 |       380 |     110 |
| (c) Client-route B1 mode plumbing and creation doors  |      44 |       384 |     106 |
| (d) Tests and measurement infrastructure              |      66 |     2,415 |     339 |
| User-facing documentation/copy                        |       7 |        13 |      13 |
| **Total**                                             | **132** | **3,268** | **584** |

The process fallback is mechanically useful without the client-route changes for browser contexts
owned by the main process, but it is not a safe standalone product shipment while client-hosted
placement remains available. An older execution client has neither the early process fallback nor
the authoritative B1 mode, so CLEAN completeness and the NATIVE split would both be ambiguous.
Separating (c) is safe only if all client-hosted creation/recovery is simultaneously disabled or
fails closed until both sides negotiate the contract. The submitted change therefore keeps (a),
(b), and (c) atomic.

## Remaining limits

- The requested 25-run live Cloudflare/mobile/NATIVE soak was not completed; live evidence is five
  fresh CLEAN branch launches interleaved with five controls. The local identity matrix ran ten
  times per arm.
- The deterministic 100-cycle Google redirect test, 25 fresh live auth flows, a human-completed
  login, and the two-hour refresh/redirect soak were not run. The live automated capture covered one
  branch flow with 25 requests.
- No Windows/Linux CI launch matrix or `--serve` Electron ordering launch was run in this worktree.
- No real imported-cookie revocation site or real site requiring NATIVE was exercised. Unit and
  integration tests cover profile persistence, route cookie-import parity, and client-hosted mode
  propagation, but not the full counted import matrix for all three external browser formats.
- Shared-worker fetches have server receipts and worker-target CDP attachment, but may be absent from
  CDP Network events. The report relies on the receipts for those wire values.
- Google did not create an auth worker in the live capture, so an auth-worker Firefox/CLEAN split was
  not observed.
