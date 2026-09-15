# Windows terminal shell selection

Two different things can put `cmd.exe` on a Windows terminal, and only one of them makes the
terminal _be_ cmd.

- **`--shell` / `shellOverride`** names the executable the PTY is spawned as. The terminal's own
  process is that shell for its whole life.
- **`--command` / `startupCommand`** is text the provider types into whatever shell it spawned.
  `--command cmd.exe` therefore starts cmd as a **child** of the host's default shell.

The difference is invisible until the child exits. Leaving that cmd returns the caller's handle to
a Git Bash or PowerShell prompt it never asked for, and anything that keyed off "this terminal is
cmd" is now wrong — while `terminal list` still shows one connected, healthy terminal, because the
PTY never changed.

## Why the runtime path needed its own fix

There are two spawn preflights, and they are twins:

- `src/main/ipc/pty/ipc/spawn-preflight.ts` — renderer/IPC spawns (a terminal tab in the app).
- `src/main/ipc/pty/runtime/spawn-preflight.ts` — runtime spawns: `terminal.create` from the CLI,
  headless `orca serve`, and every paired remote environment.

Only the IPC twin read the caller's requested shell. The runtime twin passed a literal `undefined`,
so a runtime-created terminal could only ever be the host's default shell. `orca terminal create
--command cmd.exe` against a Windows environment had no way to say "be cmd" — it could only type
`cmd.exe` into Git Bash. `src/main/ipc/pty/pty-spawn-shell-override-parity.test.ts` pins the pair.

## Rules

- A caller choosing a shell passes `--shell`; a caller running a program passes `--command`. Do not
  route a shell choice through `command` — it looks like it worked.
- The allowlist is `isSupportedWindowsShellOverride` in `src/shared/windows-terminal-shell.ts`, and
  it is the reason `--shell` cannot name an arbitrary executable. The CLI, the `terminal.create`
  RPC schema, and the relay all check the same set; add a shell in one place only.
- Bare shell names only. A path or anything with arguments is refused, so `--shell` can never carry
  a command line into `pty.spawn`.
- A host that predates `--shell` STRIPS it (`terminal.create` params are a zod object, which drops
  unknown keys) and answers with a healthy terminal running its default shell — a reply that reads
  as success. So the CLI gates on `TERMINAL_CREATE_SHELL_SELECTION_RUNTIME_CAPABILITY` and refuses
  before creating anything, rather than creating the wrong shell quietly.
- `--shell` is Windows-only. macOS and Linux hosts spawn the login shell and ignore it; the relay
  drops the value off `win32` rather than honouring it half-way.
- A WSL project runtime still wins over `--shell` (`resolveLocalWindowsTerminalRuntimeOptions`).
  That is deliberate: the project's runtime decides which machine the shell runs on, and a
  per-terminal pick may not override that.
