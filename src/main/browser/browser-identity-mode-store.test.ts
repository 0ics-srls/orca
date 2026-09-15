import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DurableFileWrite from '../durable-file-write'

const mocks = vi.hoisted(() => ({ failWrite: false }))

vi.mock('../durable-file-write', async (importOriginal) => {
  const actual = await importOriginal<typeof DurableFileWrite>()
  return {
    ...actual,
    writeFileDurableSync: (...args: Parameters<typeof actual.writeFileDurableSync>) => {
      if (mocks.failWrite) {
        throw new Error('disk refused identity write')
      }
      actual.writeFileDurableSync(...args)
    }
  }
})

import {
  BROWSER_IDENTITY_MODE_FILE,
  BROWSER_IDENTITY_MODE_VERSION,
  getBrowserIdentityModeSnapshot,
  initializeBrowserIdentityModeStore,
  resetBrowserIdentityModeStoreForTests,
  setBrowserIdentityMode
} from './browser-identity-mode-record'

function makeUserData(mode: 'clean' | 'native' = 'clean'): string {
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-browser-identity-store-'))
  writeFileSync(
    join(userDataPath, BROWSER_IDENTITY_MODE_FILE),
    JSON.stringify({
      version: BROWSER_IDENTITY_MODE_VERSION,
      mode,
      explicitSelection: false,
      migrationNoticePending: true
    }),
    'utf8'
  )
  return userDataPath
}

describe('browser identity mode store', () => {
  beforeEach(() => {
    mocks.failWrite = false
    resetBrowserIdentityModeStoreForTests()
  })

  it('durably commits an explicit selection before reporting restart state', async () => {
    const userDataPath = makeUserData()
    initializeBrowserIdentityModeStore(userDataPath)

    await expect(setBrowserIdentityMode('native')).resolves.toEqual({
      ok: true,
      identity: {
        state: 'valid',
        appliedMode: 'clean',
        configuredMode: 'native',
        explicitSelection: true,
        migrationNoticePending: false,
        restartRequired: true
      }
    })
    expect(
      JSON.parse(readFileSync(join(userDataPath, BROWSER_IDENTITY_MODE_FILE), 'utf8'))
    ).toEqual({
      version: BROWSER_IDENTITY_MODE_VERSION,
      mode: 'native',
      explicitSelection: true,
      migrationNoticePending: false
    })
  })

  it('serializes concurrent read-modify-write updates', async () => {
    const userDataPath = makeUserData()
    initializeBrowserIdentityModeStore(userDataPath)

    const first = setBrowserIdentityMode('native')
    const second = setBrowserIdentityMode('clean')

    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(second).resolves.toMatchObject({ ok: true })
    expect(getBrowserIdentityModeSnapshot()).toMatchObject({
      appliedMode: 'clean',
      configuredMode: 'clean',
      explicitSelection: true,
      restartRequired: false
    })
  })

  it('returns a structured error and keeps both values unchanged after a failed write', async () => {
    initializeBrowserIdentityModeStore(makeUserData())
    mocks.failWrite = true

    await expect(setBrowserIdentityMode('native')).resolves.toEqual({
      ok: false,
      error: {
        code: 'browser_identity_write_failed',
        message: 'disk refused identity write'
      },
      identity: {
        state: 'valid',
        appliedMode: 'clean',
        configuredMode: 'clean',
        explicitSelection: false,
        migrationNoticePending: true,
        restartRequired: false
      }
    })
    expect(getBrowserIdentityModeSnapshot()).toMatchObject({
      appliedMode: 'clean',
      configuredMode: 'clean'
    })
  })

  it('refuses ordinary updates while the record is unhealthy', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-browser-identity-store-'))
    writeFileSync(join(userDataPath, BROWSER_IDENTITY_MODE_FILE), '{bad json', 'utf8')
    initializeBrowserIdentityModeStore(userDataPath)

    await expect(setBrowserIdentityMode('native')).resolves.toMatchObject({
      ok: false,
      error: { code: 'browser_identity_reset_required' },
      identity: { state: 'corrupt', configuredMode: null, appliedMode: 'clean' }
    })
    expect(readFileSync(join(userDataPath, BROWSER_IDENTITY_MODE_FILE), 'utf8')).toBe('{bad json')
  })
})
