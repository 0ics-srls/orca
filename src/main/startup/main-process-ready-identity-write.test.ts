import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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
  writeFileAtomically: vi.fn(() => {
    throw new Error('read-only userData')
  })
}))

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
      return { browserUserAgentMode: 'native' }
    }
    onSettingsChanged() {}
    getClaudeLivePtySessionIds() {
      return []
    }
    getSshTargets() {
      return []
    }
  },
  getCanonicalUserDataPath: () => '/test-userdata'
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
describe('ready-phase browser identity authority', () => {
  beforeEach(() => {
    mocks.openMainWindow.mockClear()
    mocks.runtimeRpcStart.mockClear()
    mocks.writeFileAtomically.mockClear()
    mocks.state.isServeMode = false
  })

  it('does not mirror the active Orca profile identity over the process-wide sidecar', async () => {
    await initializeMainProcessReady({
      openMainWindow: mocks.openMainWindow,
      handleMacAppActivation: vi.fn()
    })

    expect(mocks.writeFileAtomically).not.toHaveBeenCalled()
  })

})
