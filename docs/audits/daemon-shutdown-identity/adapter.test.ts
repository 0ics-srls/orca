import { join } from 'node:path'
function resultPath(name: string): string {
  const directory = process.env.ORCA_DAEMON_IDENTITY_RESULTS
  if (!directory) {
    throw new Error('Run this proof through reproduce.mjs')
  }
  return join(directory, name)
}
import { afterAll, expect, it, vi } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import {
  startDaemonAdapterHarness,
  createMockSubprocess
} from '../../../src/main/daemon/daemon-pty-adapter-test-harness'
import { DaemonPtyAdapter } from '../../../src/main/daemon/daemon-pty-adapter'
import { DaemonServer } from '../../../src/main/daemon/daemon-server'
const candidate = process.env.ORCA_SHUTDOWN_IDENTITY_VARIANT === 'candidate'
const rows: unknown[] = []
const id = 'shutdown-identity-proof'
for (const scenario of [
  'healthy-immediate',
  'healthy-checkpoint',
  'same-daemon-reconnect',
  'lazy-shutdown',
  'restart-before-connect',
  'restart-during-checkpoint',
  'restart-while-queued',
  'same-daemon-replacement'
]) {
  it(scenario, async () => {
    let child = createMockSubprocess()
    const h = await startDaemonAdapterHarness(() => {
      child = createMockSubprocess()
      return child
    })
    const adapter = new DaemonPtyAdapter({
      socketPath: h.socketPath,
      tokenPath: h.tokenPath,
      historyPath: join(h.dir, 'history')
    })
    let foreign: DaemonPtyAdapter | undefined
    let restarted: DaemonServer | undefined
    let replacementChild: ReturnType<typeof createMockSubprocess> | undefined
    let replacementIncarnation: string | undefined
    let undo = () => {}
    let releaseLock = () => {}
    let shutdown: Promise<unknown> | undefined
    try {
      const created = await (scenario === 'lazy-shutdown' ? h.adapter : adapter).spawn({
        sessionId: id,
        cols: 80,
        rows: 24
      })
      const initialIdentity = adapter.getLastAuthenticatedDaemonIdentity()
      const originalEnsureConnected = adapter['ensureConnected'].bind(adapter)
      const restart = async (reconnect: boolean) => {
        let release = () => {}
        const disconnected = new Promise<void>((resolve) => {
          release = adapter['client'].onDisconnected(resolve)
        })
        await h.server.shutdown()
        await disconnected
        release()
        replacementChild = createMockSubprocess()
        restarted = new DaemonServer({
          socketPath: h.socketPath,
          tokenPath: h.tokenPath,
          log: { log() {}, close() {} },
          spawnSubprocess: () => replacementChild!
        })
        await restarted.start()
        foreign = new DaemonPtyAdapter({ socketPath: h.socketPath, tokenPath: h.tokenPath })
        replacementIncarnation = (await foreign.spawn({ sessionId: id, cols: 80, rows: 24 }))
          .incarnationId
        if (reconnect) {
          await originalEnsureConnected()
        }
      }
      if (scenario === 'restart-before-connect') {
        let entered = false
        adapter['ensureConnected'] = async (deadline) => {
          if (!entered) {
            entered = true
            await restart(false)
          }
          return originalEnsureConnected(deadline)
        }
        undo = () => {
          adapter['ensureConnected'] = originalEnsureConnected
        }
      }
      if (scenario === 'restart-during-checkpoint') {
        const originalCheckpoint = adapter['runExclusiveCheckpoint'].bind(adapter)
        adapter['runExclusiveCheckpoint'] = async (...args) => {
          const settled = await originalCheckpoint(...args)
          await restart(true)
          return settled
        }
        undo = () => {
          adapter['runExclusiveCheckpoint'] = originalCheckpoint
        }
      }
      if (scenario === 'same-daemon-replacement') {
        let entered = false
        adapter['ensureConnected'] = async (deadline) => {
          if (!entered) {
            entered = true
            foreign = new DaemonPtyAdapter({ socketPath: h.socketPath, tokenPath: h.tokenPath })
            await foreign.spawn({
              sessionId: id,
              cols: 80,
              rows: 24,
              attachOnly: true,
              expectedIncarnationId: created.incarnationId,
              expectedIncarnationIsAuthoritative: true
            })
            await foreign.shutdown(id, { immediate: true })
            foreign.clearTombstone(id)
            replacementIncarnation = (await foreign.spawn({ sessionId: id, cols: 80, rows: 24 }))
              .incarnationId
            replacementChild = child
          }
          return originalEnsureConnected(deadline)
        }
        undo = () => {
          adapter['ensureConnected'] = originalEnsureConnected
        }
      }
      if (scenario === 'same-daemon-reconnect') {
        adapter['client'].disconnect()
      }
      let locked: Promise<void> | undefined
      if (scenario === 'restart-while-queued') {
        let entered = () => {}
        const lockedReady = new Promise<void>((resolve) => {
          entered = resolve
        })
        const wait = new Promise<void>((resolve) => {
          releaseLock = resolve
        })
        locked = adapter['withHistorySpawnLock'](id, async () => {
          entered()
          await wait
        })
        await lockedReady
      }
      shutdown = adapter
        .shutdown(id, {
          immediate: true,
          keepHistory:
            scenario === 'healthy-checkpoint' || scenario === 'restart-during-checkpoint',
          deadlineMs: Date.now() + 2000
        })
        .then(
          () => ({ status: 'fulfilled' }),
          (error) => ({
            status: 'rejected',
            reason: error instanceof Error ? error.message : String(error)
          })
        )
      if (scenario === 'restart-while-queued') {
        await restart(true)
        releaseLock()
        await locked
      }
      const result = await shutdown
      const remaining = await (foreign ?? adapter).listProcesses()
      const replacementForceKills = replacementChild
        ? vi.mocked(replacementChild.forceKill).mock.calls.length
        : 0
      const shouldReject = candidate && scenario.startsWith('restart-')
      expect(result).toEqual(
        shouldReject
          ? { status: 'rejected', reason: 'terminal_shutdown_daemon_identity_changed' }
          : { status: 'fulfilled' }
      )
      expect(remaining).toHaveLength(shouldReject ? 1 : 0)
      if (replacementChild) {
        expect(replacementForceKills).toBe(shouldReject ? 0 : 1)
      }
      if (shouldReject) {
        expect(remaining[0].incarnationId).toBe(replacementIncarnation)
      }
      rows.push({
        scenario,
        result,
        remaining: remaining.length,
        replacementForceKills,
        identityChanged:
          initialIdentity?.launchNonce !==
          adapter.getLastAuthenticatedDaemonIdentity()?.launchNonce,
        replacementIncarnationChanged:
          replacementIncarnation !== undefined && replacementIncarnation !== created.incarnationId
      })
    } finally {
      releaseLock()
      await shutdown
      undo()
      adapter.dispose()
      h.adapter.dispose()
      foreign?.dispose()
      await h.server.shutdown()
      await restarted?.shutdown()
      rmSync(h.dir, { recursive: true, force: true })
    }
  })
}
afterAll(() => writeFileSync(resultPath('adapter.json'), JSON.stringify(rows, null, 2)))
