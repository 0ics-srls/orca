# Bundled ripgrep

Orca ships its own `rg` and never depends on the user having installed one. Quick Open, the
Explorer name filter, text search, and the paired-server `files.*` RPCs all spawn it.

## Where the binaries come from

- `@vscode/ripgrep-universal` (exact pin in `package.json`) carries prebuilt ripgrep for every
  platform inside its npm tarball: no install script, no download at install time, SHA-256 checked
  upstream at publish. Linux builds are static musl, so they pass the glibc floor
  (`linux-glibc-compatibility.md`) and run on any distro, including Alpine and WSL.
- Every desktop artifact packages the six relay platforms (`linux|darwin|win32` × `x64|arm64`)
  under `Resources/ripgrep/<platform>/rg[.exe]` (`config/bundled-ripgrep-resources.cjs`).
  - The host's own copy serves local search.
  - Windows uses the Linux copy for WSL.
  - SSH deploys upload the remote host's copy.
- `beforePack` fails when a binary is missing, and `afterPack` verifies all six and sets exec bits.
- macOS `signIgnore` keeps codesign off the Linux/Windows copies, which are inert data there.
- Windows SignPath signs every packaged `.exe`, including both `rg.exe` copies.
- `Resources/ripgrep/licenses/` carries the ripgrep, PCRE2, and musl notices the static binaries
  require.
- Plain-Node `orcad` copies its host binary to `<install root>/ripgrep/<platform>/`.

## Resolution

`src/main/ripgrep/bundled-ripgrep-path.ts` is the only resolver in the main process.
- Packaged hosts look only in `Resources/ripgrep` or orcad's install root. A missing binary
  resolves to its expected absolute path, so it fails with ENOENT. A bare `rg` there would let
  Windows run an `rg.exe` from the repo, which is the spawn cwd.
- Development and test hosts use `node_modules/@vscode/ripgrep-universal/bin`, then PATH `rg`.

Callers pass `{ wsl: true }` when the spawn is routed into a WSL distro, then spread
`bundledRipgrepWslSpawnOptions(command)` into `wslAwareSpawn`. Inside the distro, a shell
expression finds the Windows install through `wslpath -u`, which honors custom automount roots.
- It picks the Linux build for the distro's own `uname -m`. Windows-on-ARM runs x64 Orca beside
  arm64 distros, so the Windows process's architecture is the wrong key.
- It falls back to the distro's own `rg` when the install drive is not mounted.

There is no local fallback. When the bundled binary cannot start, local listing and search fail
with a clear error instead of degrading to `git ls-files`/`git grep`. The usual causes are a
damaged install or security software blocking it. This matches VS Code, which also ships rg with
no fallback. A silent, slower, partial fallback hid exactly these failures before.

## SSH remotes

`src/main/ssh/ssh-relay-ripgrep-install.ts` installs the remote platform's binary at
`~/.orca-remote/ripgrep/<content-hash>-<platform>/rg[.exe]`.
- The path is keyed on a hash of the binary's bytes, so relay upgrades never re-upload it and any
  change to the shipped binary does.
- It starts right after the relay launches, ahead of sweep/GC. It never delays connect and
  becomes available to the first Quick Open as soon as possible.
- The upload lands in a private stage directory and is renamed into place after a size check.
- A file at the final path counts as installed only when its size matches. A truncated leftover
  is replaced (on Windows only when not held open).
- The relay is always launched with `--ripgrep-path`. It re-checks the file on each spawn, prefers
  it, and falls back to PATH `rg` and then its git/readdir chain. That covers a `noexec` home, a
  failed upload, or an older client that launched the relay without the flag.
- A bundled binary that fails to launch is skipped for 60 s, then retried. Fd/process pressure
  never counts as failing. Windows antivirus commonly locks a new `rg.exe` briefly.

The relay fallbacks stay: mixed client/relay versions are normal
(`remote-wire-compatibility.md`), and a remote can refuse to execute uploaded binaries.

## Updating ripgrep

Bump the exact `@vscode/ripgrep-universal` pin in `package.json`. Nothing else changes: the SSH
cache key is the binary's content hash, so remotes fetch the new build on their next deploy.
Dependabot proposes the bump (`.github/dependabot.yml`).
