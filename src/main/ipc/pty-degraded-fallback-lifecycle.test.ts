import { describe, expect, it, vi } from 'vitest'
import { spawnMock } from './pty-ipc-mock-registry'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import {
  registerPtyHandlers,
  setLocalPtyProvider,
  getLocalPtyProvider,
  getInProcessPtyProvider,
  killAllPty
} from './pty'
import { DegradedDaemonPtyProvider } from '../daemon/degraded-daemon-pty-provider'
import type { DaemonPtyAdapter } from '../daemon/daemon-pty-adapter'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

describe('configured in-process fallback lifecycle', () => {
  const { handlers, mainWindow, createMockProc, installObservableDaemonTestProvider } =
    setupPtyIpcSuite()

  function setup() {
    const daemon = installObservableDaemonTestProvider()
    getLocalPtyProvider().onWriteUnavailable = vi.fn(() => () => {})
    const fallback = getInProcessPtyProvider()
    const provider = new DegradedDaemonPtyProvider({
      current: getLocalPtyProvider() as DaemonPtyAdapter,
      legacy: [],
      fallback
    })
    setLocalPtyProvider(provider)
    const runtime = {
      setPtyController: vi.fn(),
      noteTerminalSpawnCommand: vi.fn(),
      onPtySpawned: vi.fn(),
      onPtyData: vi.fn(),
      onPtyExit: vi.fn(),
      preAllocateHandleForPty: vi.fn(),
      getPtyOutputSequence: vi.fn(() => 3)
    }
    const process = createMockProc()
    Object.assign(process.proc, { pid: 12345, process: 'zsh' })
    spawnMock.mockReturnValue(process.proc)
    registerPtyHandlers(mainWindow as never, runtime as never)
    return { daemon, fallback, provider, runtime, process }
  }

  it('delivers local and daemon output and natural exits exactly once', async () => {
    const { daemon, provider, runtime, process } = setup()
    try {
      const result = (await handlers.get('pty:spawn')!(null, { cols: 80, rows: 24 })) as {
        id: string
      }
      process.emitData('abc')
      expect(runtime.onPtyData).toHaveBeenCalledTimes(1)
      process.emitExit()
      expect(runtime.onPtyExit).toHaveBeenCalledTimes(1)
      daemon.emitData('daemon-owned', 'def')
      expect(runtime.onPtyData).toHaveBeenCalledTimes(2)
      daemon.emitExit('daemon-owned')
      expect(runtime.onPtyExit).toHaveBeenCalledTimes(2)
      expect(mainWindow.webContents.send).toHaveBeenCalledWith(
        'pty:exit',
        expect.objectContaining({ id: result.id })
      )
    } finally {
      provider.disposeProviderOnly()
    }
  })

  it('destroys fallback handles on app quit without stopping daemon sessions', async () => {
    const { daemon, fallback, provider, process } = setup()
    try {
      const result = (await handlers.get('pty:spawn')!(null, { cols: 80, rows: 24 })) as {
        id: string
      }
      const kill = process.proc.kill
      killAllPty()
      expect(kill).toHaveBeenCalledOnce()
      expect(fallback.hasPty(result.id)).toBe(false)
      expect(daemon.shutdown).not.toHaveBeenCalled()
    } finally {
      provider.disposeProviderOnly()
    }
  })

  it('sweeps fallback orphans on reload without stopping daemon sessions', async () => {
    const { daemon, provider, process } = setup()
    try {
      await handlers.get('pty:spawn')!(null, { cols: 80, rows: 24 })
      const kill = process.proc.kill
      const reload = () => {
        for (const [name, callback] of mainWindow.webContents.on.mock.calls) {
          if (name === 'did-finish-load') {
            ;(callback as () => void)()
          }
        }
      }
      reload()
      reload()
      expect(kill).toHaveBeenCalledOnce()
      expect(daemon.shutdown).not.toHaveBeenCalled()
      process.emitExit()
    } finally {
      provider.disposeProviderOnly()
    }
  })
})
