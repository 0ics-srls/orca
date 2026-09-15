import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const readProject = (file) => readFileSync(join(projectDir, file), 'utf8')
const packageJson = JSON.parse(readProject('package.json'))
const pnpmWorkspace = parse(readProject('pnpm-workspace.yaml'))

const OWNED_ELECTRON_REBUILD = 'node config/scripts/rebuild-native-deps.mjs'
// Why exact commands and not /electron/i: the owner's own path has no "electron" in it, so a
// keyword check waves a duplicated rebuild through -- the case this contract is named for --
// while rejecting any later step that merely mentions Electron (#20787).
const ELECTRON_INSTALL_COMMANDS = [
  OWNED_ELECTRON_REBUILD,
  'electron-rebuild',
  'electron-builder install-app-deps',
  'install-app-deps'
]
const takesOverElectronInstall = (step) =>
  ELECTRON_INSTALL_COMMANDS.some((command) => step.includes(command))

describe('Electron binary install ownership', () => {
  it('keeps root postinstall as the single Electron binary install owner', () => {
    // The invariant is that the root postinstall owns the Electron binary install, not that
    // nothing may run after it -- pinning the whole string broke every open PR (#20726).
    const steps = packageJson.scripts.postinstall.split('&&').map((step) => step.trim())
    expect(steps[0]).toBe(OWNED_ELECTRON_REBUILD)
    for (const step of steps.slice(1)) {
      expect(takesOverElectronInstall(step)).toBe(false)
    }
    expect(pnpmWorkspace.allowBuilds).not.toHaveProperty('electron')
  })

  // Why a separate case: the assertion above only reads the real postinstall, so it cannot show
  // a bad chain would be caught. #20787 shipped a keyword check that missed a duplicated
  // rebuild; these fixtures pin the rejections themselves.
  it('rejects a chained step that would take over the Electron install', () => {
    expect(takesOverElectronInstall(OWNED_ELECTRON_REBUILD)).toBe(true)
    expect(takesOverElectronInstall('npx electron-rebuild')).toBe(true)
    expect(takesOverElectronInstall('npx electron-builder install-app-deps')).toBe(true)
    expect(takesOverElectronInstall('node config/scripts/sync-anti-slop-plugin.mjs')).toBe(false)
    expect(takesOverElectronInstall('node config/scripts/check-electron-version.mjs')).toBe(false)
  })
})
