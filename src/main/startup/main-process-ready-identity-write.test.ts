import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DurableFileWrite from '../durable-file-write'

const mocks = vi.hoisted(() => ({
  // Assigned in beforeAll; the factories below read it lazily, so a real directory is available
  // by the time ready composition resolves the canonical userData path.
  userDataPath: '',
  state: {
    devInstanceIdentity: { appUserModelId: 'app.id', appName: 'Orca' },
    isServeMode: false,
    mainProcessI18nReady: Promise.resolve(),
    managedWslCliReconciliationStatus: 'settled',
    initialProxyApplicationReady: Promise.resolve(),
    hangDetection: null,
    store: null
  },
  openMainWindow: vi.fn(),
  runtimeRpcStart: vi.fn(async () => {}),
  // The identity record's only writer. Watching this is what makes the pin real: asserting on
  // writeFileAtomically watched a function the identity store never calls.
  writeFileDurableSync: vi.fn(),
  writeFileAtomically: vi.fn(() => {
    throw new Error('read-only userData')
  })
}))

vi.mock('../durable-file-write', async (importOriginal) => {
  const actual = await importOriginal<typeof DurableFileWrite>()
  return {
    ...actual,
    // Records without writing: nothing in ready legitimately writes durably here, and swallowing
    // keeps a would-be regression from mutating the seeded record before it is asserted on.
    writeFileDurableSync: mocks.writeFileDurableSync
  }
})

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    setName: vi.fn(),
    getPath: vi.fn(() => '/test-userdata'),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false
  },
  session: { defaultSession: {} }
}))
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  is: { dev: false }
}))
vi.mock('./main-process-state', () => ({ mainProcessState: mocks.state }))
vi.mock('../persistence', () => ({
  Store: class {
    getSettings() {
      return {}
    }
    onSettingsChanged() {}
    getClaudeLivePtySessionIds() {
      return []
    }
    getSshTargets() {
      return []
    }
  },
  getCanonicalUserDataPath: () => mocks.userDataPath
}))
vi.mock('../codex-accounts/fs-utils', () => ({
  writeFileAtomically: mocks.writeFileAtomically
}))
vi.mock('../window/foreground-activation-policy', () => ({
  applyBackgroundActivationPolicy: vi.fn()
}))
vi.mock('../network/proxy-settings', () => ({
  applyElectronProxySettings: vi.fn(async () => ({ source: 'direct' }))
}))
vi.mock('../network/electron-proxy-request-guard', () => ({
  installElectronProxyRequestGuard: vi.fn()
}))
vi.mock('../network/electron-proxy-credentials', () => ({ handleElectronProxyLogin: vi.fn() }))
vi.mock('../hang-watchdog/main-thread-hang-watchdog', () => ({
  installMainThreadHangWatchdog: vi.fn()
}))
vi.mock('../hang-watchdog/hang-detection-marker', () => ({
  consumeHangDetectionMarker: vi.fn(() => null),
  hangDetectionMarkerPath: vi.fn(() => '/test-marker')
}))
vi.mock('../browser/browser-manager', () => ({ browserCertificateTrustController: {} }))
vi.mock('../orca-profiles/profile-index-store', () => ({
  ensureActiveOrcaProfile: () => ({
    profile: { id: 'local-default' },
    profileDirectory: '/test-profile',
    dataFile: '/test-profile/data.json'
  })
}))
vi.mock('../browser/browser-client-host-id', () => ({ initializeBrowserClientHostId: vi.fn() }))
vi.mock('../host/deferred-secret-protection-report', () => ({
  scheduleSecretProtectionGapReport: vi.fn()
}))
vi.mock('../ssh/ssh-host-key-store', () => ({ initSshHostKeyStoreFile: vi.fn() }))
vi.mock('../pty/legacy-terminal-shim-dir', () => ({ neutralizeLegacyTerminalShimDir: vi.fn() }))
vi.mock('./windows-shell-path-hydration', () => ({
  createWindowsShellPathHydration: () => ({ whenReady: Promise.resolve() })
}))
vi.mock('../git/runner', () => ({
  configureWindowsHostGitEnvironmentReadiness: vi.fn(),
  setDefaultWslDistroOverride: vi.fn()
}))
vi.mock('../agent-hooks/wsl-hook-relay-manager', () => ({
  wslHookRelayManager: { setManagedHookSettingsResolver: vi.fn() }
}))
vi.mock('../claude-accounts/live-pty-gate', () => ({
  attachClaudeLivePtyPersistence: vi.fn(),
  onLiveClaudePtysDrained: vi.fn(),
  seedLiveClaudePtysFromPersistence: vi.fn()
}))
vi.mock('../app-icon', () => ({ applyAppIcon: vi.fn() }))
vi.mock('./dev-education-suppression', () => ({
  shouldSuppressDevEducation: () => false,
  suppressDevEducationForStore: vi.fn()
}))
vi.mock('../browser/browser-session-proxy', () => ({
  applyBrowserSessionProxies: vi.fn(async () => {}),
  setBrowserNetworkProxySettingsResolver: vi.fn()
}))
vi.mock('../browser/doc-preview-protocol', () => ({ installDocPreviewProtocolHandler: vi.fn() }))
vi.mock('../ipc/doc-preview-grant-ipc', () => ({ registerDocPreviewGrantHandlers: vi.fn() }))
// The registry's own write path — startup inspection arming the notice, and an explicit choice
// retiring it — is covered against the real registry in
// browser-session-registry-identity.persistence.test.ts. What is pinned here is the rest of ready
// composition, which must not touch the record at all.
vi.mock('../browser/browser-session-startup', () => ({ initializeBrowserSessionsForApp: vi.fn() }))
vi.mock('../browser/browser-session-registry', () => ({
  browserSessionRegistry: { listProfiles: () => [] }
}))
vi.mock('./startup-diagnostics', () => ({ logStartupMilestone: vi.fn() }))
vi.mock('./http1-compatibility-marker', () => ({ writeHttp1CompatibilityMarker: vi.fn() }))
vi.mock('../crash-reporting/durable-crash-breadcrumb', () => ({
  recordDurableCrashBreadcrumb: vi.fn()
}))
vi.mock('./main-window-actions', () => ({ syncMacMenuBarIcon: vi.fn() }))
vi.mock('./gpu-lifecycle', () => ({ updateGpuAccelerationAboutPanel: vi.fn() }))
vi.mock('../cli/wsl-cli-registration-reconciliation', () => ({
  reconcileManagedWslCliRegistrations: vi.fn(async () => [])
}))
vi.mock('./wsl-cli-reconciliation-startup-barrier', () => ({
  createWslCliReconciliationStartupBarrier: () => Promise.resolve()
}))
vi.mock('../agent-hooks/managed-agent-hook-controls', () => ({
  isAgentStatusHooksEnabled: vi.fn()
}))
vi.mock('./main-process-ready-runtime', () => ({
  initializeReadyRuntimeServices: vi.fn(async () => {})
}))
vi.mock('./main-process-i18n-menu', () => ({
  initializeMainProcessI18nAndMenu: vi.fn(async () => {})
}))
vi.mock('./main-process-runtime-launch', () => ({
  initializeMainProcessRuntimeLaunch: vi.fn(async (options: { openMainWindow: () => void }) => {
    if (mocks.state.isServeMode) {
      await mocks.runtimeRpcStart()
    } else {
      options.openMainWindow()
    }
  })
}))

import { initializeMainProcessReady } from './main-process-ready'
import {
  BROWSER_IDENTITY_MODE_FILE,
  BROWSER_IDENTITY_MODE_VERSION,
  readBrowserIdentityModeRecord
} from '../browser/browser-identity-mode-record'
import {
  getBrowserIdentityModeSnapshot,
  initializeBrowserIdentityModeStore,
  resetBrowserIdentityModeStoreForTests
} from '../browser/browser-identity-mode-store'

describe('ready-phase browser identity authority', () => {
  beforeAll(() => {
    mocks.userDataPath = mkdtempSync(join(tmpdir(), 'orca-ready-identity-'))
  })

  beforeEach(() => {
    mocks.openMainWindow.mockClear()
    mocks.runtimeRpcStart.mockClear()
    mocks.writeFileDurableSync.mockClear()
    mocks.writeFileAtomically.mockClear()
    mocks.state.isServeMode = false
    resetBrowserIdentityModeStoreForTests()
  })

  // The bug: ready used to mirror a retired per-profile setting into the root record, so switching
  // from a native profile to a clean one started the clean profile in native. The root record read
  // before ready is the only authority now, and ready must not write to it in either direction.
  it.each([{ rootMode: 'native' }, { rootMode: 'clean' }])(
    'leaves root=$rootMode untouched through the whole ready composition',
    async ({ rootMode }) => {
      writeFileSync(
        join(mocks.userDataPath, BROWSER_IDENTITY_MODE_FILE),
        JSON.stringify({
          version: BROWSER_IDENTITY_MODE_VERSION,
          mode: rootMode,
          explicitSelection: true,
          migrationNoticePending: false
        }),
        'utf8'
      )
      // Preflight's read is what fixes the identity for this launch.
      initializeBrowserIdentityModeStore(mocks.userDataPath)

      await initializeMainProcessReady({
        openMainWindow: mocks.openMainWindow,
        handleMacAppActivation: vi.fn()
      })

      const snapshot = getBrowserIdentityModeSnapshot()
      expect(snapshot.appliedMode).toBe(rootMode)
      expect(snapshot.configuredMode).toBe(rootMode)
      expect(readBrowserIdentityModeRecord(mocks.userDataPath)).toMatchObject({
        state: 'valid',
        appliedMode: rootMode,
        configuredMode: rootMode,
        explicitSelection: true
      })
      // The identity store writes the record through writeFileDurableSync and nothing else, so any
      // ready-phase write to it lands here. Matched on the target path rather than on the spy as a
      // whole, so an unrelated durable write elsewhere in ready cannot fail this for the wrong reason.
      expect(
        mocks.writeFileDurableSync.mock.calls.filter(([, target]) =>
          String(target).endsWith(BROWSER_IDENTITY_MODE_FILE)
        )
      ).toEqual([])
    }
  )
})
