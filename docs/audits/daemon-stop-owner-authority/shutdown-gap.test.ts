import { join } from 'node:path'
import type { PtyRuntimeControllerDeps } from '../../../src/main/ipc/pty/runtime/controller-deps'

function resultPath(name: string): string {
  const directory = process.env.ORCA_DAEMON_STOP_RESULTS
  if (!directory) {
    throw new Error('Run this proof through reproduce.mjs')
  }
  return join(directory, name)
}

import { expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { startLateExitHarness } from '../../../src/main/ipc/pty/daemon-late-exit-test-fixture'
import { createMockSubprocess } from '../../../src/main/daemon/daemon-pty-adapter-test-harness'
import { DaemonPtyAdapter } from '../../../src/main/daemon/daemon-pty-adapter'
import { DaemonServer } from '../../../src/main/daemon/daemon-server'
import { DaemonPtyRouter } from '../../../src/main/daemon/daemon-pty-router'
import { setLocalPtyProvider } from '../../../src/main/ipc/pty/provider/registry'
import { bindProviderListeners } from '../../../src/main/ipc/pty/provider/bind-listeners'
import { stopAndWaitPtyFromRuntimeController } from '../../../src/main/ipc/pty/runtime/kill'
import { shutdownProviderAndDetectExit } from '../../../src/main/ipc/pty/provider/shutdown-detect'
import { finishPtyShutdown } from '../../../src/main/ipc/pty/provider/liveness'

it('a completion fence cannot undo a kill sent to a replacement daemon during shutdown', async () => {
  const h = await startLateExitHarness()
  const router = new DaemonPtyRouter({ current: h.adapter, legacy: [] })
  let restarted: DaemonServer | undefined
  let foreign: DaemonPtyAdapter | undefined
  const replacementChild = createMockSubprocess()
  const replacementKill = vi.spyOn(replacementChild, 'forceKill')
  let replacementIncarnation: string | undefined
  let undoShutdown: (() => void) | undefined
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await router.discoverLegacySessions()
    setLocalPtyProvider(router)
    bindProviderListeners(h.session)
    h.pauseStream()
    const beforeIdentity = h.adapter.getLastAuthenticatedDaemonIdentity()
    const originalShutdown = h.adapter.shutdown.bind(h.adapter)
    const intercept = vi.spyOn(h.adapter, 'shutdown').mockImplementation(async (id, opts) => {
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
        spawnSubprocess: () => replacementChild
      })
      await restarted.start()
      foreign = new DaemonPtyAdapter({ socketPath: h.socketPath, tokenPath: h.tokenPath })
      const created = await foreign.spawn({ sessionId: id, cols: 80, rows: 24 })
      replacementIncarnation = created.incarnationId
      expect(replacementIncarnation).not.toBe(h.result.incarnationId)
      await originalShutdown(id, opts)
    })
    undoShutdown = () => intercept.mockRestore()
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
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: exact-stop reads only these controller ports and optional store; spawn ports are unused.
    const controllerDeps = deps as unknown as PtyRuntimeControllerDeps
    const stopped = await stopAndWaitPtyFromRuntimeController(controllerDeps, h.id, {
      deadlineMs: Date.now() + 1500
    })
    const rows = await h.adapter.listProcesses()
    expect(stopped).toBe(process.env.ORCA_DAEMON_STOP_VARIANT !== 'candidate')
    expect(replacementKill).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([])
    const result = {
      stopped,
      daemonIdentityChanged:
        beforeIdentity?.launchNonce !== h.adapter.getLastAuthenticatedDaemonIdentity()?.launchNonce,
      replacementIncarnationChanged: replacementIncarnation !== h.result.incarnationId,
      replacementForceKills: replacementKill.mock.calls.length,
      remainingProcesses: rows.length,
      ownerChangeRejectedAtCompletion: warnings.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('terminal_stop_owner_changed'))
      )
    }
    writeFileSync(resultPath('shutdown-gap.json'), JSON.stringify(result, null, 2))
  } finally {
    undoShutdown?.()
    warnings.mockRestore()
    router.disposeRouterOnly()
    await h.dispose()
    foreign?.dispose()
    await restarted?.shutdown()
  }
})

import { rmSync } from 'node:fs'
import { startDaemonAdapterHarness } from '../../../src/main/daemon/daemon-pty-adapter-test-harness'
import {
  restorePtyIncarnation,
  setPtyOwnership
} from '../../../src/main/ipc/pty/provider/ownership-state'

it('an unknown route still kills current even when the captured incarnation belongs to legacy', async () => {
  const h = await startLateExitHarness()
  const foreignChild = createMockSubprocess()
  const legacy = await startDaemonAdapterHarness(() => foreignChild)
  const router = new DaemonPtyRouter({ current: h.adapter, legacy: [legacy.adapter] })
  const wrongKill = vi.spyOn(h.subprocess, 'forceKill')
  try {
    const intended = await legacy.adapter.spawn({ sessionId: h.id, cols: 80, rows: 24 })
    expect(intended.incarnationId).not.toBe(h.result.incarnationId)
    restorePtyIncarnation(h.id, intended.incarnationId!)
    setPtyOwnership(h.id, null)
    h.runtime.registerPty(h.id, 'repo::/tmp/late-exit-audit', null, {
      tabId: '00000000-0000-4000-8000-000000000001',
      leafId: '00000000-0000-4000-8000-000000000002',
      incarnationId: intended.incarnationId
    })
    setLocalPtyProvider(router)
    bindProviderListeners(h.session)
    h.pauseStream()
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
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: exact-stop reads only these controller ports and optional store; spawn ports are unused.
    const controllerDeps = deps as unknown as PtyRuntimeControllerDeps
    const stopped = await stopAndWaitPtyFromRuntimeController(controllerDeps, h.id, {
      deadlineMs: Date.now() + 1500
    })
    const currentRows = await h.adapter.listProcesses()
    const intendedRows = await legacy.adapter.listProcesses()
    expect(stopped).toBe(false)
    expect(wrongKill).toHaveBeenCalledTimes(1)
    expect(currentRows).toEqual([])
    expect(intendedRows).toHaveLength(1)
    expect(intendedRows[0].incarnationId).toBe(intended.incarnationId)
    writeFileSync(
      resultPath('unknown-owner-gap.json'),
      JSON.stringify(
        {
          stopped,
          wrongCurrentForceKills: wrongKill.mock.calls.length,
          currentRemaining: currentRows.length,
          intendedLegacyRemaining: intendedRows.length
        },
        null,
        2
      )
    )
  } finally {
    router.disposeRouterOnly()
    await h.dispose()
    legacy.adapter.dispose()
    await legacy.server.shutdown()
    rmSync(legacy.dir, { recursive: true, force: true })
  }
})

it('endpoint identity cannot fence another client replacing the raw ID inside the same daemon', async () => {
  const h = await startLateExitHarness()
  const router = new DaemonPtyRouter({ current: h.adapter, legacy: [] })
  const foreign = new DaemonPtyAdapter({ socketPath: h.socketPath, tokenPath: h.tokenPath })
  let undoShutdown: (() => void) | undefined
  let replacementKills = 0
  let replacementIncarnation: string | undefined
  try {
    await router.discoverLegacySessions()
    setLocalPtyProvider(router)
    bindProviderListeners(h.session)
    h.pauseStream()
    const identity = h.adapter.getLastAuthenticatedDaemonIdentity()
    const originalShutdown = h.adapter.shutdown.bind(h.adapter)
    const intercepted = vi.spyOn(h.adapter, 'shutdown').mockImplementation(async (id, opts) => {
      await foreign.spawn({
        sessionId: id,
        cols: 80,
        rows: 24,
        attachOnly: true,
        expectedIncarnationId: h.result.incarnationId,
        expectedIncarnationIsAuthoritative: true
      })
      await foreign.shutdown(id, { immediate: true })
      foreign.clearTombstone(id)
      const replacement = await foreign.spawn({ sessionId: id, cols: 80, rows: 24 })
      replacementIncarnation = replacement.incarnationId
      const killed = vi.spyOn(h.subprocess, 'forceKill')
      await originalShutdown(id, opts)
      replacementKills = killed.mock.calls.length
    })
    undoShutdown = () => intercepted.mockRestore()
    const ports = {
      runtime: h.runtime,
      getLocalPtyProviderStartupPromise: () => undefined,
      shutdownProviderAndDetectExit,
      rememberSyntheticKillExit: h.session.rememberSyntheticKillExit,
      sendPtyExitToRenderer: h.session.sendPtyExitToRenderer,
      finishPtyShutdown,
      retiredRejectedPtyIds: new Map(),
      reversibleStopOwnersByPtyId: new Map()
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: exact-stop reads only these controller ports and optional store; spawn ports are unused.
    const deps = ports as unknown as PtyRuntimeControllerDeps
    const stopped = await stopAndWaitPtyFromRuntimeController(deps, h.id, {
      deadlineMs: Date.now() + 1500
    })
    const rows = await h.adapter.listProcesses()
    expect(stopped).toBe(true)
    expect(replacementKills).toBe(1)
    expect(rows).toEqual([])
    expect(replacementIncarnation).not.toBe(h.result.incarnationId)
    expect(h.adapter.getLastAuthenticatedDaemonIdentity()).toEqual(identity)
    writeFileSync(
      resultPath('same-daemon-gap.json'),
      JSON.stringify(
        {
          stopped,
          daemonIdentityChanged: false,
          replacementIncarnationChanged: true,
          replacementForceKills: replacementKills,
          remainingProcesses: rows.length
        },
        null,
        2
      )
    )
  } finally {
    undoShutdown?.()
    router.disposeRouterOnly()
    await h.dispose()
    foreign.dispose()
  }
})
