# Native dependency install policy

Ordinary `pnpm install` installs optional native dependencies for the current OS
and CPU. This applies to local development and root-project CI jobs, including
jobs using `.github/actions/install-node-dependencies`. Mobile and cloud projects
with their own workspace configuration are separate.

Cross-target release packaging explicitly retains the previous broad install:

```sh
pnpm install:release --frozen-lockfile
```

Run this before local cross-target packaging, including `pnpm build:mac`, whose
default Electron Builder configuration produces both x64 and arm64 artifacts.
Release packaging workflows pass the equivalent pnpm 12 flags directly:
`--os=current,darwin,linux,win32 --cpu=current,x64,arm64`.
Keeping `current` includes the host's build tools as well as target resources.
An install for another target does not itself cross-compile native addons.

Tests that inspect installed Windows addons and their packaging closure run on
Windows, where those dependencies are required. The PR Windows lane explicitly
includes them. Loading the packaging config tolerates absent Windows addons,
but its `beforePack` hook rejects Windows packaging until they are installed.
Patch-source assertions, fixture tests, and the isolated real patch-install test
continue to run on other hosts.

## Existing checkouts

A normal incremental install can leave previously installed variants behind.
Stop development processes using this checkout, remove **this checkout's**
`node_modules`, then run `pnpm install --frozen-lockfile` to obtain a fresh host
install. Do not use `--force`: pnpm 12 documents that it installs optional packages
even when their OS/CPU/libc do not match. The shared pnpm download store is separate;
this change does not clear it.

## Measurement: macOS arm64, pnpm 12.0.0

Measured 2026-09-12 with the same package manifest, lockfile, patch files, and
existing download store in two fresh install directories. Both installs used
`--frozen-lockfile --ignore-scripts --offline`. One used the old broad architecture
policy; the other overrode it with `--os=current --cpu=current`.

| Measure                                    | Broad install |  Host install |             Reduction |
| ------------------------------------------ | ------------: | ------------: | --------------------: |
| Package directories                        |         1,296 |         1,206 |                    90 |
| Regular files                              |        53,972 |        52,915 |                 1,057 |
| Logical package bytes                      | 2,485,153,773 | 1,159,396,649 | 1,325,757,124 (53.3%) |
| Logical package GiB                        |          2.31 |          1.08 |                  1.23 |
| Install wall time, single warm-cache trial |       11.98 s |       11.25 s |                0.73 s |

| Native family       | Broad MiB | Host MiB |
| ------------------- | --------: | -------: |
| Canvas              |     235.7 |     25.8 |
| Sherpa speech       |     235.2 |     71.6 |
| oxlint and tsgolint |     234.0 |     32.7 |
| SWC                 |     225.8 |     24.4 |
| TypeScript          |     158.4 |     26.2 |

The original family-size estimates are reproducible. The saving is measured
logical file content, **not unique physical disk space**: pnpm hardlinks and APFS
clones may share storage. Electron downloads and native rebuild outputs are absent
from both trials. The single warm-cache timing pair does not establish a speedup;
network transfer and cold CI install timings were not measured. Fresh CI jobs
materialize fewer packages, but existing download caches may still contain all
variants until they age out.

To reproduce, use two disposable checkouts of the same revision, each starting
without `node_modules`. Run these respective install commands:

```sh
pnpm install --frozen-lockfile --ignore-scripts --offline --os=current,darwin,linux,win32 --cpu=current,x64,arm64
pnpm install --frozen-lockfile --ignore-scripts --offline --os=current --cpu=current
```

After each install, run `node config/scripts/measure-pnpm-install.mjs`. The script
counts regular file bytes in the virtual store without following symlinks. It also
accepts a different `node_modules` path. An offline cache miss requires populating
the store first; keep cache state and lifecycle-script settings consistent when
comparing results. Linux/Windows size and timing results require trials on those
hosts; the macOS numbers should not be presented as CI savings.
