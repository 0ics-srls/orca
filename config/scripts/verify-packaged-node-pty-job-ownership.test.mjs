import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  packagedConptyCandidates,
  verifyPackagedConptyBreakawayMarker,
  verifyPackagedNodePtyJobOwnership,
  verifyPackagedWindowsNodePty
} = require('./verify-packaged-node-pty-job-ownership.cjs')
const { CYGWIN_BREAKAWAY_MARKER } = require('./node-pty-job-ownership.cjs')
const { PE_MACHINE } = require('./windows-pe-machine.cjs')

const fixtureDir = mkdtempSync(join(tmpdir(), 'packaged-node-pty-job-'))
const ELECTRON_BUILDER_CONFIG = readFileSync(
  new URL('../electron-builder.config.cjs', import.meta.url),
  'utf8'
)

/**
 * A real enough addon: a PE header the arch check can read, and the wide literal
 * the marker check looks for. A fixture that is neither cannot exercise a gate
 * that reads the binary.
 */
function conptyImage({ arch = 'x64', cygwinBreakawayDenied = true } = {}) {
  const image = Buffer.alloc(0x88)
  image.write('MZ', 0, 'latin1')
  image.writeUInt32LE(0x80, 0x3c)
  image.write('PE\0\0', 0x80, 'latin1')
  image.writeUInt16LE(PE_MACHINE[arch], 0x84)
  return Buffer.concat([image, cygwinBreakawayDenied ? CYGWIN_BREAKAWAY_MARKER : Buffer.alloc(0)])
}

function writeAddon(name, options) {
  const path = join(fixtureDir, name)
  writeFileSync(path, conptyImage(options))
  return path
}

/** A packaged resources tree carrying exactly the conpty.node files named. */
function packagedResources(addons) {
  const resourcesDir = mkdtempSync(join(fixtureDir, 'resources-'))
  const nodePtyDir = join(resourcesDir, 'node_modules', 'node-pty')
  for (const [relativePath, options] of Object.entries(addons)) {
    const addonPath = join(nodePtyDir, ...relativePath.split('/'))
    mkdirSync(dirname(addonPath), { recursive: true })
    writeFileSync(addonPath, conptyImage(options))
  }
  return resourcesDir
}

const CURRENT_ADDON = writeAddon('current.node', { cygwinBreakawayDenied: true })
const PRE_MSYS_ADDON = writeAddon('pre-msys.node', { cygwinBreakawayDenied: false })

const PATCHED = {
  dir: '../build/Release/',
  module: {
    listJobProcessIds: () => [],
    terminateJob: () => true,
    assignCurrentProcessToJob: () => true
  }
}

const packaged = (native, addonPath = CURRENT_ADDON) => ({
  platform: 'win32',
  loadNative: () => ({ native, addonPath })
})

describe('verifyPackagedNodePtyJobOwnership', () => {
  it('accepts the packaged patched ConPTY binding', () => {
    expect(() => verifyPackagedNodePtyJobOwnership('resources', packaged(PATCHED))).not.toThrow()
  })

  it('rejects a packaged upstream prebuild', () => {
    expect(() =>
      verifyPackagedNodePtyJobOwnership(
        'resources',
        packaged({ dir: '../prebuilds/win32-x64/', module: {} })
      )
    ).toThrow(/missing listJobProcessIds, terminateJob, assignCurrentProcessToJob/)
  })

  // A release built against a stale native cache ships the MSYS orphan bug
  // while exporting every job function, so packaging has to read the binary.
  it('rejects a packaged build that predates the Cygwin/MSYS breakaway denial', () => {
    expect(() =>
      verifyPackagedNodePtyJobOwnership('resources', packaged(PATCHED, PRE_MSYS_ADDON))
    ).toThrow(/predates the Cygwin\/MSYS job-breakaway denial/)
  })

  it('requires the patched source-build directory', () => {
    expect(() =>
      verifyPackagedNodePtyJobOwnership(
        'resources',
        packaged({ ...PATCHED, dir: '../prebuilds/win32-x64/' })
      )
    ).toThrow(/expected patched build\/Release/)
  })

  it('does not load Windows natives for other targets', () => {
    const loadNative = vi.fn()
    verifyPackagedNodePtyJobOwnership('resources', { platform: 'linux', loadNative })
    expect(loadNative).not.toHaveBeenCalled()
  })
})

describe('packagedConptyCandidates', () => {
  // Pinned because the gate resolves the addon by walking this list in order:
  // a wrong order blesses a binary the app would never reach.
  it('walks the paths node-pty tries, in node-pty order', () => {
    expect(packagedConptyCandidates('RES', 'arm64').map((candidate) => candidate.path)).toEqual([
      join('RES', 'node_modules', 'node-pty', 'build', 'Release', 'conpty.node'),
      join('RES', 'node_modules', 'node-pty', 'lib', 'build', 'Release', 'conpty.node'),
      join('RES', 'node_modules', 'node-pty', 'build', 'Debug', 'conpty.node'),
      join('RES', 'node_modules', 'node-pty', 'lib', 'build', 'Debug', 'conpty.node'),
      join('RES', 'node_modules', 'node-pty', 'prebuilds', 'win32-arm64', 'conpty.node'),
      join('RES', 'node_modules', 'node-pty', 'lib', 'prebuilds', 'win32-arm64', 'conpty.node')
    ])
  })

  // Only the published prebuild gets the "no rebuild here can fix this" advice.
  it('knows which of them node-pty publishes prebuilt', () => {
    expect(packagedConptyCandidates('RES', 'x64').map((candidate) => candidate.prebuilt)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true
    ])
  })
})

describe('verifyPackagedConptyBreakawayMarker', () => {
  // The release as built today: prunePackagedNodePty already dropped the
  // same-arch prebuild because a patched source build replaced it.
  it('passes a package whose only ConPTY load path carries the denial', () => {
    const resourcesDir = packagedResources({ 'build/Release/conpty.node': {} })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).not.toThrow()
  })

  // The cross-host package. No host but Windows can build conpty.node, so there
  // is no build/Release for prune to have replaced the prebuild with -- and the
  // published prebuild is exactly the binary that leaks every MSYS pane child.
  it('fails a cross-host package left holding the published prebuild', () => {
    const resourcesDir = packagedResources({
      'prebuilds/win32-x64/conpty.node': { cygwinBreakawayDenied: false }
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).toThrow(
      /predates the Cygwin\/MSYS job-breakaway denial/
    )
  })

  it('tells that package how to fix it, which is not a rebuild it can run', () => {
    const resourcesDir = packagedResources({
      'prebuilds/win32-x64/conpty.node': { cygwinBreakawayDenied: false }
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).toThrow(
      /Package this Windows slice on a host that can build node-pty for win32-x64/
    )
  })

  // The cross-arch package that worked: beforeBuild rebuilds node-pty for the
  // TARGET arch, so build/Release is patched and loadable and the prebuild
  // prune left behind is never reached. Failing this would be a false positive
  // whose advice -- change hosts -- is both wrong and impossible.
  it('passes a cross-arch package whose build/Release really is the target arch', () => {
    const resourcesDir = packagedResources({
      'build/Release/conpty.node': { arch: 'arm64' },
      'prebuilds/win32-arm64/conpty.node': { arch: 'arm64', cygwinBreakawayDenied: false }
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'arm64')).not.toThrow()
  })

  // The cross-arch package that silently did not: build/Release is the
  // packaging host's own arch, the target cannot load it, and the loader falls
  // through to the unpatched prebuild underneath.
  it('fails a cross-arch package whose build/Release is the packaging host arch', () => {
    const resourcesDir = packagedResources({
      'build/Release/conpty.node': { arch: 'x64' },
      'prebuilds/win32-arm64/conpty.node': { arch: 'arm64', cygwinBreakawayDenied: false }
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'arm64')).toThrow(
      /prebuilds[\\/]win32-arm64/
    )
  })

  it('refuses a package whose every conpty.node is the wrong architecture', () => {
    const resourcesDir = packagedResources({ 'build/Release/conpty.node': { arch: 'x64' } })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'arm64')).toThrow(
      /none of them is a win32-arm64 image/
    )
  })

  it('ignores a prebuild for an arch this slice will never load', () => {
    const resourcesDir = packagedResources({
      'build/Release/conpty.node': {},
      'prebuilds/win32-arm64/conpty.node': { arch: 'arm64', cygwinBreakawayDenied: false }
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).not.toThrow()
  })

  // build/Debug sits between Release and the prebuilds in the load order, and
  // nothing prunes it, so it wins whenever Release cannot be loaded.
  it('resolves past a Release build the target cannot load', () => {
    const resourcesDir = packagedResources({
      'build/Release/conpty.node': { arch: 'x64' },
      'build/Debug/conpty.node': { arch: 'arm64', cygwinBreakawayDenied: false }
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'arm64')).toThrow(
      /build[\\/]Debug/
    )
  })

  // A stale source build is the packaging host's own to rebuild, so it gets the
  // advice that actually works rather than the cross-host one.
  it('tells a stale source build to rebuild, not to change hosts', () => {
    const resourcesDir = packagedResources({
      'build/Release/conpty.node': { cygwinBreakawayDenied: false }
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).toThrow(
      /Rebuild node-pty from source/
    )
  })

  // Nothing to load is not "a layout we do not recognise", it is a package with
  // no ConPTY backend, and a gate that cannot see its subject is not a gate.
  it('refuses rather than skip a package with no conpty.node at all', () => {
    const resourcesDir = packagedResources({})
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).toThrow(
      /no conpty\.node on any path its loader tries/
    )
  })

  it('names every path it looked at when it finds none', () => {
    const resourcesDir = packagedResources({})
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).toThrow(
      /build[\\/]Release[\s\S]*build[\\/]Debug[\s\S]*prebuilds[\\/]win32-x64/
    )
  })

  // Present but unreadable is the state that used to pass, so it must not warn.
  it('refuses when a candidate is there but cannot be read', () => {
    const resourcesDir = packagedResources({})
    mkdirSync(join(resourcesDir, 'node_modules', 'node-pty', 'build', 'Release', 'conpty.node'), {
      recursive: true
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).toThrow()
  })

  it('accepts the electron-builder Arch enum the afterPack hook passes', () => {
    const resourcesDir = packagedResources({
      'prebuilds/win32-arm64/conpty.node': { arch: 'arm64' }
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 3)).not.toThrow()
  })

  it('refuses a target arch no Windows slice ships', () => {
    const resourcesDir = packagedResources({ 'build/Release/conpty.node': {} })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'ia32')).toThrow(
      /Unsupported packaged node-pty Windows architecture/
    )
  })

  it('looks where electron-builder actually lands the addon', () => {
    const exists = vi.fn().mockReturnValue(false)
    expect(() =>
      verifyPackagedConptyBreakawayMarker(join('out', 'win-unpacked', 'resources'), 'x64', {
        exists
      })
    ).toThrow()
    expect(exists).toHaveBeenCalledWith(
      join(
        'out',
        'win-unpacked',
        'resources',
        'node_modules',
        'node-pty',
        'build',
        'Release',
        'conpty.node'
      )
    )
  })
})

describe('verifyPackagedWindowsNodePty', () => {
  const spies = () => ({ verifyMarker: vi.fn(), verifyExports: vi.fn() })

  // The bug this replaced: the marker check sat in the else of the host gate, so
  // the cross-host package it exists for was the one package it never checked.
  it.each([
    ['a cross-platform host', { hostPlatform: 'darwin', canExecuteTargetArch: true }],
    ['a cross-arch slice', { hostPlatform: 'win32', canExecuteTargetArch: false }],
    ['both', { hostPlatform: 'linux', canExecuteTargetArch: false }],
    ['neither', { hostPlatform: 'win32', canExecuteTargetArch: true }]
  ])('checks the marker on %s', (_case, host) => {
    const { verifyMarker, verifyExports } = spies()
    verifyPackagedWindowsNodePty('resources', 'x64', { ...host, verifyMarker, verifyExports })
    expect(verifyMarker).toHaveBeenCalledWith('resources', 'x64')
  })

  it('loads the addon for the export check only where that can work', () => {
    const { verifyMarker, verifyExports } = spies()
    verifyPackagedWindowsNodePty('resources', 'x64', {
      hostPlatform: 'win32',
      canExecuteTargetArch: true,
      verifyMarker,
      verifyExports
    })
    expect(verifyExports).toHaveBeenCalledWith('resources')
  })

  it.each([
    ['a cross-platform host', { hostPlatform: 'darwin', canExecuteTargetArch: true }],
    ['a cross-arch slice', { hostPlatform: 'win32', canExecuteTargetArch: false }]
  ])('skips the export check on %s', (_case, host) => {
    const { verifyMarker, verifyExports } = spies()
    verifyPackagedWindowsNodePty('resources', 'x64', { ...host, verifyMarker, verifyExports })
    expect(verifyExports).not.toHaveBeenCalled()
  })

  // Swallowing the marker verdict would leave a gate that runs and decides
  // nothing, which is the failure mode this whole change is about.
  it('lets the marker verdict fail the package', () => {
    const verifyMarker = vi.fn(() => {
      throw new Error('predates the Cygwin/MSYS job-breakaway denial')
    })
    expect(() =>
      verifyPackagedWindowsNodePty('resources', 'x64', {
        hostPlatform: 'win32',
        canExecuteTargetArch: true,
        verifyMarker,
        verifyExports: vi.fn()
      })
    ).toThrow(/predates the Cygwin\/MSYS job-breakaway denial/)
  })

  it('is what the afterPack hook calls for a Windows slice', () => {
    expect(ELECTRON_BUILDER_CONFIG).toContain(
      'verifyPackagedWindowsNodePty(resourcesDir, context.arch, { canExecuteTargetArch })'
    )
  })
})
