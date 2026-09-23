import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { toBundledRipgrepPlatform } from '../../shared/bundled-ripgrep'
import { execFileSync } from 'node:child_process'
import { BUNDLED_RIPGREP_VERSION } from '../../shared/bundled-ripgrep'
import {
  bundledRipgrepCommand,
  bundledRipgrepWslSpawnOptions,
  resetBundledRipgrepPathCacheForTests,
  resolveBundledRipgrepPath
} from './bundled-ripgrep-path'

const originalResourcesPath = process.resourcesPath

function setResourcesPath(value: string | undefined): void {
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value })
}

describe('bundled ripgrep path', () => {
  afterEach(() => {
    setResourcesPath(originalResourcesPath)
    resetBundledRipgrepPathCacheForTests()
  })

  it('resolves the checkout binary for this host in development', () => {
    setResourcesPath(undefined)
    const command = bundledRipgrepCommand()

    expect(command).toContain(join('@vscode', 'ripgrep-universal', 'bin'))
    expect(existsSync(command)).toBe(true)
  })

  it('resolves the Linux build for WSL-routed spawns', () => {
    setResourcesPath(undefined)
    const linuxPlatform = toBundledRipgrepPlatform('linux', process.arch)

    expect(bundledRipgrepCommand({ wsl: true })).toContain(join('bin', `${linuxPlatform}`, 'rg'))
  })

  it('prefers the packaged resources copy', () => {
    const resourcesDir = mkdtempSync(join(tmpdir(), 'orca-rg-resources-'))
    try {
      const packaged = join(resourcesDir, 'ripgrep', 'linux-x64', 'rg')
      mkdirSync(join(resourcesDir, 'ripgrep', 'linux-x64'), { recursive: true })
      writeFileSync(packaged, '')
      chmodSync(packaged, 0o755)
      setResourcesPath(resourcesDir)

      expect(resolveBundledRipgrepPath('linux-x64')).toBe(realpathSync(packaged))
    } finally {
      rmSync(resourcesDir, { recursive: true, force: true })
    }
  })

  it('names no bundled build for platforms outside the relay set', () => {
    expect(toBundledRipgrepPlatform('freebsd', 'x64')).toBeNull()
    expect(toBundledRipgrepPlatform('win32', 'ia32')).toBeNull()
  })

  it('keys the remote cache on the version the pinned binary reports', () => {
    setResourcesPath(undefined)
    const version = execFileSync(bundledRipgrepCommand(), ['--version'], { encoding: 'utf8' })

    expect(version.split('\n')[0]).toMatch(
      new RegExp(`^ripgrep ${BUNDLED_RIPGREP_VERSION.replaceAll('.', '\\.')}\\b`)
    )
  })

  it('picks the distro-arch Linux build via wslpath, else the distro rg', () => {
    const { wslShellCommand } = bundledRipgrepWslSpawnOptions(
      'C:\\Program Files\\Orca\\resources\\ripgrep\\linux-x64\\rg'
    )

    expect(wslShellCommand).toContain(`wslpath -u 'C:\\Program Files\\Orca\\resources\\ripgrep'`)
    expect(wslShellCommand).toContain('aarch64|arm64) a=linux-arm64')
    expect(wslShellCommand).toContain('else printf rg')
    expect(bundledRipgrepWslSpawnOptions('rg')).toEqual({})
  })
})
