const { existsSync } = require('node:fs')
const { createRequire } = require('node:module')
const { join } = require('node:path')
const {
  assertNodePtyJobOwnership,
  assertCygwinBreakawayDenied,
  conptyDeniesCygwinBreakaway,
  nodePtyAddonPath
} = require('./node-pty-job-ownership.cjs')
const { normalizeNodePtyWindowsArch } = require('../packaged-runtime-node-modules.cjs')

/**
 * Every conpty.node the packaged tree can hand `loadNativeModule`, in its order.
 *
 * Why not just build/Release: that loader swallows each failure and falls
 * through, so a wrong-arch or unloadable Release build silently hands the pane
 * to the next candidate. The published prebuild is always that next candidate
 * and never carries the patch, so each path present is a live load path.
 */
function packagedConptyCandidates(resourcesDir, targetArch) {
  const nodePtyDir = join(resourcesDir, 'node_modules', 'node-pty')
  return [
    join(nodePtyDir, 'build', 'Release', 'conpty.node'),
    join(nodePtyDir, 'build', 'Debug', 'conpty.node'),
    join(nodePtyDir, 'prebuilds', `win32-${targetArch}`, 'conpty.node')
  ]
}

function loadPackagedConpty(resourcesDir) {
  const packagedRequire = createRequire(join(resourcesDir, 'package.json'))
  const utilsPath = packagedRequire.resolve('./node_modules/node-pty/lib/utils')
  const { loadNativeModule } = packagedRequire(utilsPath)
  const native = loadNativeModule('conpty')
  return { native, addonPath: nodePtyAddonPath(utilsPath, native, 'conpty') }
}

function verifyPackagedNodePtyJobOwnership(resourcesDir, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    return
  }

  const { native, addonPath } = (options.loadNative ?? loadPackagedConpty)(resourcesDir)
  assertNodePtyJobOwnership({ platform, nativeName: 'conpty', native, addonPath })
  if (!native.dir.replace(/\\/g, '/').includes('build/Release/')) {
    throw new Error(`Packaged node-pty resolved to ${native.dir}; expected patched build/Release`)
  }
  console.log('[verify-packaged-node-pty] OK — packaged ConPTY owns process trees')
}

/**
 * The half of the packaged check that survives a cross-host build.
 *
 * The export check has to load the addon, so it cannot run when the packaging
 * host is not the target platform/arch -- and that skip is how a Windows
 * release built elsewhere could ship a node-pty that leaks every MSYS pane
 * child out of its job. Reading the binary needs neither.
 *
 * It sweeps every candidate rather than one path because a cross-host package
 * has no build/Release at all and a cross-arch one has an unloadable build/Release:
 * in both the addon that actually runs is the unpatched prebuild that
 * prunePackagedNodePty could not replace. Checking only build/Release warns on
 * the first and prints OK on the second.
 *
 * No candidate at all is fatal, not skipped: it means the packaged app has no
 * ConPTY backend to load, which a gate must not shrug at.
 */
function verifyPackagedConptyBreakawayMarker(resourcesDir, targetArch, options = {}) {
  // Deliberately no host-platform gate: the caller has already established that
  // the *target* is Windows, and gating on the host is the very skip this
  // closes.
  const architecture = normalizeNodePtyWindowsArch(targetArch)
  const candidates = packagedConptyCandidates(resourcesDir, architecture)
  const exists = options.exists ?? existsSync
  const present = candidates.filter((candidate) => exists(candidate))
  if (present.length === 0) {
    throw new Error(
      [
        `Packaged node-pty for win32-${architecture} has no conpty.node on any path its loader`,
        `tries (${candidates.join(', ')}), so the packaged app has no ConPTY backend at all.`,
        'Nothing here can be checked for the Cygwin/MSYS job-breakaway denial, and a gate that',
        'cannot see its subject refuses rather than assume.'
      ].join(' ')
    )
  }
  for (const candidate of present) {
    if ((options.deniesBreakaway ?? conptyDeniesCygwinBreakaway)(candidate)) {
      continue
    }
    // A source build that is merely stale: rebuilding it on this host is the fix,
    // which is exactly what assertCygwinBreakawayDenied already says.
    if (!candidate.includes(`win32-${architecture}`)) {
      assertCygwinBreakawayDenied(candidate, { dir: candidate })
    }
    throw new Error(
      [
        `Packaged node-pty for win32-${architecture} would load ${candidate}, the published`,
        'prebuilt fallback, which predates the Cygwin/MSYS job-breakaway denial: its per-PTY job',
        'still carries JOB_OBJECT_LIMIT_BREAKAWAY_OK, so every Git Bash pane child is created',
        'outside the job and survives terminatePtyJob.',
        'It is still in the package because no patched build/Release/conpty.node for',
        `win32-${architecture} is here for prunePackagedNodePty to have replaced it with, and only`,
        `a node-pty source build on a Windows ${architecture} host produces one.`,
        `Package this Windows slice on a Windows ${architecture} host.`,
        'See docs/reference/windows-msys-job-breakaway.md.'
      ].join(' ')
    )
  }
  console.log(
    `[verify-packaged-node-pty] OK — all ${present.length} packaged ConPTY load path(s) for ` +
      `win32-${architecture} deny MSYS job breakaway`
  )
}

module.exports = { verifyPackagedNodePtyJobOwnership, verifyPackagedConptyBreakawayMarker }
