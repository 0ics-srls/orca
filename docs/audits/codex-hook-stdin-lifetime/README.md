# #15833: generated Codex POSIX hook waits for EOF

The actual current Codex script remains blocked after receiving a complete JSON payload while its caller keeps stdin open. On macOS with Node 26.6, the fixture held the pipe for **10,250 ms**; the process was still alive, then exited successfully roughly 10 ms after EOF. An immediate-EOF control completed in about 18 ms. The current Grok script, which selects the existing complete-JSON reader, exited in about 45 ms while its pipe remained open for two seconds.

This reproduces the script-level liveness mechanism described in [#15833](https://github.com/stablyai/orca/issues/15833). `codex-hook-script.ts` selects the default `cat` reader through `buildPosixHookPayloadCapture()`. The managed definition declares a ten-second timeout for the caller; it does not create a timer inside this shell script. The HTTP request's timeout cannot bound a read that happens before the HTTP command. Named `v1.4.183` source has the same default capture selection in its older monolithic hook service.

The fixture executes generated scripts from temporary files under `/bin/sh`. It sets empty endpoint/port/token values so no HTTP request, installed hook edit, spool write or agent launch occurs. It closes the fixture pipe and waits for every child; a watchdog covers test failure. No terminal UI is read or modified. Grok's positive control requires a Python interpreter on the shell's default path, as the existing reader otherwise falls back to `cat`. Windows skips these POSIX controls.

The experiment does **not** invoke Codex CLI 0.149.0, establish why that runner reportedly failed to enforce its timeout, reproduce duplicate user-hook loading, measure process memory, or explain #19831's OOM. A held hook is a liveness/resource ownership problem; repeated processes and unbounded memory are not inferred from one blocked invocation. The other EOF-reader consumers and interpreter fallback also need contract review before changing a shared default. No product fix is included here.

Run from the repository root:

```sh
ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run --config docs/audits/codex-hook-stdin-lifetime/config.mjs
```

`ORCA_HOOK_EOF_OUTPUT` selects the report path. Electron repeat uses the installed Electron executable with `ELECTRON_RUN_AS_NODE=1`; it creates no app window. `source-versions.json` fences selected current generator/caller boundaries and records named main/reported-release source hashes. This is not a complete import-graph fence or historical application execution.
