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
const { isLoadableByArch } = require('./windows-pe-machine.cjs')

/**
 * Every conpty.node the packaged tree can hand `loadNativeModule`, in its order.
 *
 * Why the order matters: the loader swallows each require failure and falls
 * through, so a wrong-arch or otherwise unloadable build hands the pane to the
 * next candidate. First loadable wins, and the published prebuild is always the
 * last one standing.
 */
function packagedConptyCandidates(resourcesDir, targetArch) {
  const nodePtyDir = join(resourcesDir, 'node_modules', 'node-pty')
  const layouts = [
    { segments: ['build', 'Release'], prebuilt: false },
    { segments: ['build', 'Debug'], prebuilt: false },
    { segments: ['prebuilds', `win32-${targetArch}`], prebuilt: true }
  ]
  // Each layout is tried relative to node-pty's root, then to lib/, before the
  // next layout -- the unbundled then bundled pair node-pty's loader walks.
  return layouts.flatMap(({ segments, prebuilt }) =>
    [nodePtyDir, join(nodePtyDir, 'lib')].map((root) => ({
      path: join(root, ...segments, 'conpty.node'),
      prebuilt
    }))
  )
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
 * It resolves the addon the way the loader does rather than reading one path,
 * because the path that matters is not always build/Release:
 *
 * | package              | build/Release            | prebuild pruned | loads        |
 * | -------------------- | ------------------------ | --------------- | ------------ |
 * | same host, same arch | patched                  | yes             | build/Release|
 * | cross host           | absent, cannot be built  | no              | the prebuild |
 * | cross arch, built    | patched, target arch     | no              | build/Release|
 * | cross arch, failed   | host arch, target cannot load | no         | the prebuild |
 *
 * Only the arch of the binary separates the last two, so this reads the PE
 * machine field instead of assuming. Checking every present file instead would
 * fail row three, whose package is correct and whose leftover prebuild is never
 * reached.
 *
 * Nothing loadable is fatal, not skipped: that package has no ConPTY backend,
 * which a gate must not shrug at.
 */
function verifyPackagedConptyBreakawayMarker(resourcesDir, targetArch, options = {}) {
  // Deliberately no host-platform gate: the caller has already established that
  // the *target* is Windows, and gating on the host is the very skip this
  // closes.
  const architecture = normalizeNodePtyWindowsArch(targetArch)
  const candidates = packagedConptyCandidates(resourcesDir, architecture)
  const exists = options.exists ?? existsSync
  const present = candidates.filter((candidate) => exists(candidate.path))
  if (present.length === 0) {
    throw new Error(
      [
        `Packaged node-pty for win32-${architecture} has no conpty.node on any path its loader`,
        `tries (${candidates.map((c) => c.path).join(', ')}), so the packaged app has no`,
        'ConPTY backend at all.',
        'Nothing here can be checked for the Cygwin/MSYS job-breakaway denial, and a gate that',
        'cannot see its subject refuses rather than assume.'
      ].join(' ')
    )
  }
  const loadable = options.loadableByArch ?? isLoadableByArch
  const loaded = present.find((candidate) => loadable(candidate.path, architecture))
  if (!loaded) {
    throw new Error(
      [
        `Packaged node-pty for win32-${architecture} has conpty.node at`,
        `${present.map((c) => c.path).join(', ')},`,
        `but none of them is a win32-${architecture} image, so the app can load none of them.`,
        "A cross-arch rebuild that quietly emitted the packaging host's architecture looks",
        'exactly like this. Rebuild node-pty for the target arch and repackage.'
      ].join(' ')
    )
  }
  const addonPath = loaded.path
  if ((options.deniesBreakaway ?? conptyDeniesCygwinBreakaway)(addonPath)) {
    console.log(
      `[verify-packaged-node-pty] OK — win32-${architecture} loads ${addonPath}, which denies ` +
        'MSYS job breakaway'
    )
    return
  }
  // A stale source build is the packaging host's own to rebuild, which is what
  // assertCygwinBreakawayDenied already says. The prebuild is not: it never
  // carries the patch, and no rebuild on this host replaces it.
  if (!loaded.prebuilt) {
    assertCygwinBreakawayDenied(addonPath, { dir: addonPath })
  }
  throw new Error(
    [
      `Packaged node-pty for win32-${architecture} loads ${addonPath}, the published prebuilt`,
      'fallback, which predates the Cygwin/MSYS job-breakaway denial: its per-PTY job still',
      'carries JOB_OBJECT_LIMIT_BREAKAWAY_OK, so every Git Bash pane child is created outside',
      'the job and survives terminatePtyJob.',
      'It is still here because no patched build/Release/conpty.node for',
      `win32-${architecture} was produced for prunePackagedNodePty to replace it with, and only`,
      `a node-pty source build targeting win32-${architecture} produces one.`,
      `Package this Windows slice on a host that can build node-pty for win32-${architecture}.`,
      'See docs/reference/windows-msys-job-breakaway.md.'
    ].join(' ')
  )
}

/**
 * The whole Windows verdict for one packaged slice.
 *
 * Both halves live here rather than in the afterPack hook so that "the marker
 * sweep runs even when the export check cannot" is a tested claim instead of
 * the shape of an if/else somebody could re-nest.
 */
function verifyPackagedWindowsNodePty(resourcesDir, targetArch, options = {}) {
  ;(options.verifyMarker ?? verifyPackagedConptyBreakawayMarker)(resourcesDir, targetArch)
  const hostPlatform = options.hostPlatform ?? process.platform
  if (hostPlatform !== 'win32' || !options.canExecuteTargetArch) {
    console.log(
      '[verify-packaged-node-pty] skipped the export check on a cross-platform or cross-arch package'
    )
    return
  }
  ;(options.verifyExports ?? verifyPackagedNodePtyJobOwnership)(resourcesDir)
}

module.exports = {
  packagedConptyCandidates,
  verifyPackagedConptyBreakawayMarker,
  verifyPackagedNodePtyJobOwnership,
  verifyPackagedWindowsNodePty
}
