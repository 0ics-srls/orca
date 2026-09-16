import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  verifyPackagedNodePtyJobOwnership,
  verifyPackagedConptyBreakawayMarker
} = require('./verify-packaged-node-pty-job-ownership.cjs')
const { CYGWIN_BREAKAWAY_MARKER } = require('./node-pty-job-ownership.cjs')

const fixtureDir = mkdtempSync(join(tmpdir(), 'packaged-node-pty-job-'))
const ELECTRON_BUILDER_CONFIG = readFileSync(
  new URL('../electron-builder.config.cjs', import.meta.url),
  'utf8'
)

function writeAddon(name, { cygwinBreakawayDenied }) {
  const path = join(fixtureDir, name)
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from('MZ fake addon '),
      cygwinBreakawayDenied ? CYGWIN_BREAKAWAY_MARKER : Buffer.alloc(0)
    ])
  )
  return path
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

/**
 * A packaged resources tree carrying exactly the conpty.node files named.
 *
 * Paths are relative to node-pty's root, so they read as the load order
 * `loadNativeModule` walks: build/Release, build/Debug, prebuilds/win32-<arch>.
 */
function packagedResources(addons) {
  const resourcesDir = mkdtempSync(join(fixtureDir, 'resources-'))
  const nodePtyDir = join(resourcesDir, 'node_modules', 'node-pty')
  for (const [relativePath, cygwinBreakawayDenied] of Object.entries(addons)) {
    const addonPath = join(nodePtyDir, ...relativePath.split('/'))
    mkdirSync(dirname(addonPath), { recursive: true })
    writeFileSync(
      addonPath,
      Buffer.concat([
        Buffer.from('MZ fake addon '),
        cygwinBreakawayDenied ? CYGWIN_BREAKAWAY_MARKER : Buffer.alloc(0)
      ])
    )
  }
  return resourcesDir
}

describe('verifyPackagedConptyBreakawayMarker', () => {
  // The release as built today: prunePackagedNodePty already dropped the
  // same-arch prebuild because a patched source build replaced it.
  it('passes a package whose only ConPTY load path carries the denial', () => {
    const resourcesDir = packagedResources({ 'build/Release/conpty.node': true })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).not.toThrow()
  })

  // The cross-host package. No host but Windows can build conpty.node, so there
  // is no build/Release for prune to have replaced the prebuild with -- and the
  // published prebuild is exactly the binary that leaks every MSYS pane child.
  it('fails a cross-host package left holding the published prebuild', () => {
    const resourcesDir = packagedResources({ 'prebuilds/win32-x64/conpty.node': false })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).toThrow(
      /prebuilds[\\/]win32-x64[\\/]conpty\.node[\s\S]*predates the Cygwin\/MSYS job-breakaway denial/
    )
  })

  it('tells that package how to fix it, which is not a rebuild it can run', () => {
    const resourcesDir = packagedResources({ 'prebuilds/win32-x64/conpty.node': false })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).toThrow(
      /Package this Windows slice on a Windows x64 host/
    )
  })

  // The cross-arch package, and the reason this sweeps instead of checking one
  // path: build/Release is the packaging host's own arch, so the target app
  // cannot load it and falls through to the prebuild underneath.
  it('fails a cross-arch package even though its build/Release is patched', () => {
    const resourcesDir = packagedResources({
      'build/Release/conpty.node': true,
      'prebuilds/win32-arm64/conpty.node': false
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'arm64')).toThrow(
      /prebuilds[\\/]win32-arm64/
    )
  })

  it('ignores a prebuild for an arch this slice will never load', () => {
    const resourcesDir = packagedResources({
      'build/Release/conpty.node': true,
      'prebuilds/win32-arm64/conpty.node': false
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).not.toThrow()
  })

  // build/Debug sits between Release and the prebuilds in the load order and
  // nothing prunes it, so an unmarked one there is a live load path too.
  it('fails on an unmarked addon at any load path, not just the first', () => {
    const resourcesDir = packagedResources({
      'build/Release/conpty.node': true,
      'build/Debug/conpty.node': false
    })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 'x64')).toThrow(
      /predates the Cygwin\/MSYS job-breakaway denial/
    )
  })

  // A stale source build is the developer's own to rebuild, so it gets the
  // advice that actually works rather than the cross-host one.
  it('tells a stale source build to rebuild, not to change hosts', () => {
    const resourcesDir = packagedResources({ 'build/Release/conpty.node': false })
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

  it('accepts the electron-builder Arch enum the afterPack hook passes', () => {
    const resourcesDir = packagedResources({ 'prebuilds/win32-arm64/conpty.node': true })
    expect(() => verifyPackagedConptyBreakawayMarker(resourcesDir, 3)).not.toThrow()
  })

  it('refuses a target arch no Windows slice ships', () => {
    const resourcesDir = packagedResources({ 'build/Release/conpty.node': true })
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

describe('the afterPack hook that runs these', () => {
  const windowsBlock = ELECTRON_BUILDER_CONFIG.slice(
    ELECTRON_BUILDER_CONFIG.indexOf("if (context.electronPlatformName === 'win32') {")
  ).split('\n    }\n')[0]

  it('checks the marker for every Windows slice it packages', () => {
    expect(windowsBlock).toContain(
      'verifyPackagedConptyBreakawayMarker(resourcesDir, context.arch)'
    )
  })

  // The bug this replaced: the marker check sat in the else of the host gate, so
  // the cross-host package it exists for was the one package it never checked.
  it('does not put the marker check behind the host-platform gate', () => {
    expect(windowsBlock.indexOf('verifyPackagedConptyBreakawayMarker')).toBeLessThan(
      windowsBlock.indexOf("process.platform === 'win32'")
    )
  })

  it('still loads the addon for the export check when the host can', () => {
    expect(windowsBlock).toContain('verifyPackagedNodePtyJobOwnership(resourcesDir)')
  })
})
