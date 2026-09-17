# Ordinary RPC admission under a pending provider

The local socket transport limits input bytes and connections, while the request
admission layer counts long polls separately. This bounded diagnostic checks
what those limits mean for ordinary calls whose provider has not settled.

```sh
ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run --config docs/audits/rpc-inflight-admission-review/vitest.config.mjs
```

The fixture invokes actual socket parsing, authentication, request admission,
dispatcher and `worktree.list` / `terminal.wait` handlers. It uses an inert socket
and delayed runtime methods. To avoid application initialization, it constructs
the admission object from its actual prototype with explicitly supplied counters
and limits, including a 16-call long-poll limit. It does not start a host or use
an actual filesystem/network stall.

| Observation                                               | Result       |
| --------------------------------------------------------- | ------------ |
| Ordinary calls offered through one socket                 | 128          |
| Ordinary calls started / still pending after socket close | 128 / 128    |
| Ordinary provider calls after deliberate settlement       | 0            |
| Abort signals forwarded to ordinary dispatcher calls      | 0            |
| Long polls offered / admitted / rejected                  | 32 / 16 / 16 |
| Long polls and active sockets after socket close          | 0 / 0        |

Socket close aborts transport-owned signals. Ordinary requests have already
passed admission without forwarding that signal to the dispatcher, so they
finish when the deliberately pending provider finishes. Long polls receive
their abort signal and free their admission slots. Late replies do not write to
the closed socket.

This establishes a conditional pending-request capacity gap. It does not prove
that an ordinary production provider stalls forever, measure retained bytes, or
attribute an OOM to this route. Adding a universal concurrency limit can reject
legitimate user operations, so no product policy change is proposed here.
[Results](./results.json) record the fixture and seven selected source hashes;
other imported dependencies are the current checkout, not a historical bundle.
