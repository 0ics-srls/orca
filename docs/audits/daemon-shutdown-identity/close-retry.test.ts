import type { PtyRuntimeControllerDeps } from '../../../src/main/ipc/pty/runtime/controller-deps'
import { join } from 'node:path'
function resultPath(name: string): string {
  const directory = process.env.ORCA_DAEMON_IDENTITY_RESULTS
  if (!directory) {
    throw new Error('Run this proof through reproduce.mjs')
  }
  return join(directory, name)
}
import { expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { startLateExitHarness } from '../../../src/main/ipc/pty/daemon-late-exit-test-fixture'
import {
  waitFor,
  createMockSubprocess
} from '../../../src/main/daemon/daemon-pty-adapter-test-harness'
import { DaemonPtyAdapter } from '../../../src/main/daemon/daemon-pty-adapter'
import { DaemonServer } from '../../../src/main/daemon/daemon-server'
import {
  killPtyFromRuntimeController,
  stopAndWaitPtyFromRuntimeController
} from '../../../src/main/ipc/pty/runtime/kill'
import { shutdownProviderAndDetectExit } from '../../../src/main/ipc/pty/provider/shutdown-detect'
import { finishPtyShutdown } from '../../../src/main/ipc/pty/provider/liveness'
it('runtime close retries the identity-refused stop against the new endpoint', async () => {
  const candidate = process.env.ORCA_SHUTDOWN_IDENTITY_VARIANT === 'candidate'
  const h = await startLateExitHarness()
  let restarted: DaemonServer | undefined
  let foreign: DaemonPtyAdapter | undefined
  let fallbackKills = 0
  const replacement = createMockSubprocess()
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const original = h.adapter['ensureConnected'].bind(h.adapter)
  try {
    const deps = {
      runtime: h.runtime,
      getLocalPtyProviderStartupPromise: () => undefined,
      shutdownProviderAndDetectExit,
      rememberSyntheticKillExit: h.session.rememberSyntheticKillExit,
      sendPtyExitToRenderer: h.session.sendPtyExitToRenderer,
      finishPtyShutdown,
      retiredRejectedPtyIds: new Map(),
      reversibleStopOwnersByPtyId: new Map()
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: stop and kill use only these controller ports and optional store; spawn ports are unused.
    const controllerDeps = deps as unknown as PtyRuntimeControllerDeps
    h.runtime.setPtyController({
      write: () => true,
      getForegroundProcess: async () => null,
      stopAndWait: (id) =>
        stopAndWaitPtyFromRuntimeController(controllerDeps, id, { deadlineMs: Date.now() + 1500 }),
      kill: (id) => {
        fallbackKills++
        return killPtyFromRuntimeController(controllerDeps, id)
      }
    })
    const terminal = (await h.runtime.listTerminals()).terminals.find((t) => t.ptyId === h.id)!
    h.pauseStream()
    let entered = false
    h.adapter['ensureConnected'] = async (deadline) => {
      if (!entered) {
        entered = true
        let release = () => {}
        const disconnected = new Promise<void>((resolve) => {
          release = h.adapter['client'].onDisconnected(resolve)
        })
        await h.server.shutdown()
        await disconnected
        release()
        restarted = new DaemonServer({
          socketPath: h.socketPath,
          tokenPath: h.tokenPath,
          log: { log() {}, close() {} },
          spawnSubprocess: () => replacement
        })
        await restarted.start()
        foreign = new DaemonPtyAdapter({ socketPath: h.socketPath, tokenPath: h.tokenPath })
        const created = await foreign.spawn({ sessionId: h.id, cols: 80, rows: 24 })
        expect(created.incarnationId).not.toBe(h.result.incarnationId)
      }
      await original(deadline)
    }
    const close = await h.runtime.closeTerminal(terminal.handle)
    await waitFor(() => h.session.syntheticKillExitPtyIds.has(h.id))
    const remaining = await h.adapter.listProcesses()
    const forceKills = vi.mocked(replacement.forceKill).mock.calls.length
    const gracefulKills = vi.mocked(replacement.kill).mock.calls.length
    expect(fallbackKills).toBe(candidate ? 1 : 0)
    expect(forceKills).toBe(candidate ? 0 : 1)
    expect(gracefulKills).toBe(candidate ? 1 : 0)
    expect(remaining).toEqual([])
    writeFileSync(
      resultPath('close-retry.json'),
      JSON.stringify(
        {
          close: { ptyKilled: close.ptyKilled, verdict: close.ptyStopVerdict },
          fallbackKills,
          forceKills,
          gracefulKills,
          remaining: remaining.length,
          identityRefusal: warning.mock.calls.some((args) =>
            args.some(
              (a) =>
                typeof a === 'string' && a.includes('terminal_shutdown_daemon_identity_changed')
            )
          )
        },
        null,
        2
      )
    )
  } finally {
    h.adapter['ensureConnected'] = original
    warning.mockRestore()
    await h.dispose()
    foreign?.dispose()
    await restarted?.shutdown()
  }
})
