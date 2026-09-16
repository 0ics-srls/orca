import { join } from 'node:path'
import type { PtyRuntimeControllerDeps } from '../../../src/main/ipc/pty/runtime/controller-deps'

function resultPath(name: string): string {
  const directory = process.env.ORCA_DAEMON_STOP_RESULTS
  if (!directory) {
    throw new Error('Run this proof through reproduce.mjs')
  }
  return join(directory, name)
}

import { afterAll, expect, it, vi } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { startLateExitHarness } from '../../../src/main/ipc/pty/daemon-late-exit-test-fixture'
import {
  createMockSubprocess,
  startDaemonAdapterHarness
} from '../../../src/main/daemon/daemon-pty-adapter-test-harness'
import { DaemonServer } from '../../../src/main/daemon/daemon-server'
import { DaemonPtyRouter } from '../../../src/main/daemon/daemon-pty-router'
import { setLocalPtyProvider } from '../../../src/main/ipc/pty/provider/registry'
import { bindProviderListeners } from '../../../src/main/ipc/pty/provider/bind-listeners'
import { stopAndWaitPtyFromRuntimeController } from '../../../src/main/ipc/pty/runtime/kill'
import { shutdownProviderAndDetectExit } from '../../../src/main/ipc/pty/provider/shutdown-detect'
import { finishPtyShutdown } from '../../../src/main/ipc/pty/provider/liveness'
import {
  ptyIncarnationById,
  setPtyOwnership,
  restorePtyIncarnation
} from '../../../src/main/ipc/pty/provider/ownership-state'

const rows: unknown[] = []
const patched = process.env.ORCA_DAEMON_STOP_VARIANT === 'candidate'
for (const scenario of [
  'healthy',
  'unrelated-down',
  'known-collision',
  'unknown-owner',
  'replacement-after-shutdown',
  'target-identity-changed',
  'target-restarted',
  'other-adapter-replacement'
]) {
  it(scenario, async () => {
    const h = await startLateExitHarness()
    const legacy = await startDaemonAdapterHarness(() => createMockSubprocess())
    const router = new DaemonPtyRouter({ current: h.adapter, legacy: [legacy.adapter] })
    const warnings = vi.spyOn(console, 'warn')
    const initialIdentity = h.adapter.getLastAuthenticatedDaemonIdentity()
    let restartedServer: DaemonServer | undefined
    let undoList: (() => void) | undefined
    let undoShutdown: (() => void) | undefined
    let undoIdentity: (() => void) | undefined
    let pendingOwnerInventory: Promise<void> | undefined
    try {
      if (scenario === 'known-collision') {
        const foreign = await legacy.adapter.spawn({ sessionId: h.id, cols: 80, rows: 24 })
        expect(foreign.incarnationId).not.toBe(h.result.incarnationId)
      }
      if (scenario !== 'unknown-owner') {
        await router.discoverLegacySessions()
      }
      if (scenario === 'known-collision') {
        await router.spawn({
          sessionId: h.id,
          cols: 80,
          rows: 24,
          attachOnly: true,
          expectedIncarnationId: h.result.incarnationId,
          expectedIncarnationIsAuthoritative: true
        })
      }
      setLocalPtyProvider(router)
      bindProviderListeners(h.session)
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
      if (
        scenario !== 'healthy' &&
        scenario !== 'known-collision' &&
        scenario !== 'replacement-after-shutdown' &&
        scenario !== 'other-adapter-replacement'
      ) {
        await legacy.server.shutdown()
      }
      if (scenario === 'other-adapter-replacement') {
        const original = h.adapter.shutdown.bind(h.adapter)
        const spy = vi.spyOn(h.adapter, 'shutdown').mockImplementation(async (id, opts) => {
          await original(id, opts)
          const next = await legacy.adapter.spawn({ sessionId: h.id, cols: 80, rows: 24 })
          await router.spawn({
            sessionId: h.id,
            cols: 80,
            rows: 24,
            attachOnly: true,
            expectedIncarnationId: next.incarnationId,
            expectedIncarnationIsAuthoritative: true
          })
          restorePtyIncarnation(h.id, next.incarnationId!)
          setPtyOwnership(h.id, null)
          h.runtime.registerPty(h.id, 'repo::/tmp/late-exit-audit', null, {
            tabId: '00000000-0000-4000-8000-000000000001',
            leafId: '00000000-0000-4000-8000-000000000002',
            incarnationId: next.incarnationId
          })
        })
        undoShutdown = () => spy.mockRestore()
      }
      if (scenario === 'replacement-after-shutdown') {
        const original = h.adapter.listProcesses.bind(h.adapter)
        let replaced = false
        const spy = vi.spyOn(h.adapter, 'listProcesses').mockImplementation(async (opts) => {
          if (!replaced) {
            replaced = true
            h.adapter.clearTombstone(h.id)
            const next = await h.adapter.spawn({ sessionId: h.id, cols: 80, rows: 24 })
            expect(next.incarnationId).not.toBe(h.result.incarnationId)
            restorePtyIncarnation(h.id, next.incarnationId!)
            setPtyOwnership(h.id, null)
            h.runtime.registerPty(h.id, 'repo::/tmp/late-exit-audit', null, {
              tabId: '00000000-0000-4000-8000-000000000001',
              leafId: '00000000-0000-4000-8000-000000000002',
              incarnationId: next.incarnationId
            })
          }
          return original(opts)
        })
        undoList = () => spy.mockRestore()
      }
      if (scenario === 'target-restarted') {
        let finishOwnerInventory = () => {}
        pendingOwnerInventory = new Promise<void>((resolve) => {
          finishOwnerInventory = resolve
        })
        const original = h.adapter.listProcesses.bind(h.adapter)
        let restarted = false
        const spy = vi.spyOn(h.adapter, 'listProcesses').mockImplementation(async (opts) => {
          if (!restarted) {
            restarted = true
            let releaseDisconnect = () => {}
            const disconnected = new Promise<void>((resolve) => {
              releaseDisconnect = h.adapter['client'].onDisconnected(resolve)
            })
            await h.server.shutdown()
            await disconnected
            releaseDisconnect()
            restartedServer = new DaemonServer({
              socketPath: h.socketPath,
              tokenPath: h.tokenPath,
              log: { log() {}, close() {} },
              spawnSubprocess: () => createMockSubprocess()
            })
            await restartedServer.start()
          }
          try {
            return await original(opts)
          } finally {
            finishOwnerInventory()
          }
        })
        undoList = () => spy.mockRestore()
      }
      if (scenario === 'target-identity-changed') {
        const identity = h.adapter.getLastAuthenticatedDaemonIdentity()
        expect(identity).not.toBeNull()
        let reads = 0
        const spy = vi
          .spyOn(h.adapter, 'getLastAuthenticatedDaemonIdentity')
          .mockImplementation(() => {
            reads++
            return reads === 1 ? identity : { ...identity!, launchNonce: 'replacement-identity' }
          })
        undoIdentity = () => spy.mockRestore()
      }
      h.pauseStream()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: exact-stop reads only these controller ports and optional store; spawn ports are unused.
      const controllerDeps = deps as unknown as PtyRuntimeControllerDeps
      const stopped = await stopAndWaitPtyFromRuntimeController(controllerDeps, h.id, {
        deadlineMs: Date.now() + 1500
      })
      await pendingOwnerInventory
      undoList?.()
      undoList = undefined
      undoIdentity?.()
      undoIdentity = undefined
      const target = await h.adapter.listProcesses()
      const foreign =
        scenario === 'known-collision' || scenario === 'other-adapter-replacement'
          ? await legacy.adapter.listProcesses()
          : []
      const incarnation = ptyIncarnationById.get(h.id)
      const ownerChangedWarning = warnings.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('terminal_stop_owner_changed'))
      )
      if (scenario === 'target-restarted' && patched) {
        expect(ownerChangedWarning).toBe(true)
      }
      rows.push({
        scenario,
        stopped,
        ownerChangedWarning,
        daemonIdentityChanged:
          initialIdentity?.launchNonce !==
          h.adapter.getLastAuthenticatedDaemonIdentity()?.launchNonce,
        target: target.map((p) => ({
          id: p.id,
          isOriginal: p.incarnationId === h.result.incarnationId
        })),
        foreign: foreign.map((p) => ({
          id: p.id,
          isOriginal: p.incarnationId === h.result.incarnationId
        })),
        globalStillOriginal: incarnation === h.result.incarnationId,
        globalPresent: incarnation !== undefined,
        state: h.runtime.captureState()
      })
      expect(stopped).toBe(
        scenario === 'healthy' ||
          (patched && (scenario === 'unrelated-down' || scenario === 'known-collision'))
      )
      if (scenario === 'known-collision') {
        expect(target).toHaveLength(0)
        expect(foreign).toHaveLength(1)
      }
      if (scenario === 'other-adapter-replacement') {
        expect(foreign).toHaveLength(1)
        expect(incarnation).toBe(foreign[0].incarnationId)
      }
      if (scenario === 'replacement-after-shutdown') {
        expect(target).toHaveLength(1)
        expect(incarnation).toBe(target[0].incarnationId)
      }
      h.resumeStream()
      if (
        scenario !== 'replacement-after-shutdown' &&
        scenario !== 'target-restarted' &&
        !(patched && scenario === 'target-identity-changed')
      ) {
        await h.waitForExit()
      }
      if (patched && scenario === 'target-identity-changed') {
        expect(target).toHaveLength(1)
        expect(target[0].incarnationId).toBe(h.result.incarnationId)
      }
    } finally {
      undoList?.()
      undoIdentity?.()
      undoShutdown?.()
      warnings.mockRestore()
      router.disposeRouterOnly()
      await h.dispose()
      await restartedServer?.shutdown()
      legacy.adapter.dispose()
      await legacy.server.shutdown()
      rmSync(legacy.dir, { recursive: true, force: true })
    }
  })
}
afterAll(() => writeFileSync(resultPath('authority.json'), JSON.stringify(rows, null, 2)))
