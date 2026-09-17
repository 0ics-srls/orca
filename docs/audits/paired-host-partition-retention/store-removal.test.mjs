import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { handlers, clearStorage } = vi.hoisted(() => ({
  handlers: new Map(),
  clearStorage: vi.fn(async () => ({ clearedPartitions: [], livePartitions: [] }))
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'orca-audit',
    getVersion: () => '0.0.0',
    isPackaged: false,
    on() {},
    whenReady: () => Promise.resolve()
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString()
  },
  ipcMain: {
    on: (name, handler) => handlers.set(name, handler),
    handle: (name, handler) => handlers.set(name, handler)
  },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../../../src/main/browser/browser-route-partition-storage-runtime', () => ({
  clearBrowserRoutePartitionStorageForEnvironment: clearStorage
}))

const { Store } = await import('../../../src/main/persistence/loading-store/store')
const { registerRuntimeEnvironmentConnectivityHandlers } =
  await import('../../../src/main/ipc/runtime-environment-connectivity-handlers')
const { registerSessionHandlers } = await import('../../../src/main/ipc/session')
const { registerRendererShutdownCheckpointHandler } =
  await import('../../../src/main/ipc/renderer-shutdown-checkpoint')
const { addEnvironmentFromPairingCode, listEnvironments } =
  await import('../../../src/shared/runtime-environment-store')
const { encodePairingOffer } = await import('../../../src/shared/pairing')
const { getDefaultWorkspaceSession } = await import('../../../src/shared/constants')
const { toRuntimeExecutionHostId } = await import('../../../src/shared/execution-host')
const cleanups = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
})

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-partition-audit-'))
  const dataFile = join(dir, 'orca-data.json')
  const store = new Store({ dataFile })
  const invalidateTransport = vi.fn(async () => {})
  registerRuntimeEnvironmentConnectivityHandlers({
    store,
    getUserDataPath: () => dir,
    invalidateTransport
  })
  registerSessionHandlers(store, undefined)
  registerRendererShutdownCheckpointHandler(store)
  cleanups.push(() => {
    store.flush()
    rmSync(dir, { recursive: true, force: true })
  })
  return { dir, dataFile, store, invalidateTransport }
}

function pair(dir, name) {
  return addEnvironmentFromPairingCode(dir, {
    name,
    pairingCode: encodePairingOffer({
      v: 2,
      endpoint: 'ws://192.0.2.10:6768',
      deviceToken: 'audit-inert',
      publicKeyB64: Buffer.alloc(32, 1).toString('base64')
    })
  })
}

function session(id) {
  const worktreeId = `repo-a::/audit/${id}`
  return {
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: {
      [worktreeId]: [
        {
          id: `tab-${id}`,
          worktreeId,
          ptyId: null,
          title: 'Audit',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    }
  }
}

describe('explicit GUI unpair and persisted workspace partitions', () => {
  it.each(['session:set', 'session:patch', 'session:set-sync', 'app:stage-before-unload-sync'])(
    'accepts a late %s write after simulated exact partition deletion',
    async (channel) => {
      const { dir, store } = fixture()
      const environment = pair(dir, 'late-write')
      const hostId = toRuntimeExecutionHostId(environment.id)
      store.setWorkspaceSession(session('before'), hostId)
      handlers.get('runtimeEnvironments:remove')(null, { selector: environment.id })
      expect(listEnvironments(dir)).toEqual([])
      // Simulate only the proposed exact partition deletion to test whether a late writer revives it.
      delete store.runtime.state.workspaceSessionsByHostId[hostId]
      expect(store.getWorkspaceSessionHostIds()).not.toContain(hostId)
      const event = {}
      const payload = channel === 'session:patch' ? { activeTabId: 'late-scalar' } : session('late')
      if (channel === 'app:stage-before-unload-sync') {
        handlers.get(channel)(event, { sessions: [{ state: payload, hostId }], ui: {} })
        expect(event.returnValue).toEqual({ ok: true })
        await expect(handlers.get('app:await-before-unload-checkpoint')()).resolves.toEqual({
          ok: true
        })
      } else {
        await handlers.get(channel)(event, payload, hostId)
      }
      expect(store.getWorkspaceSessionHostIds()).toContain(hostId)
    }
  )

  it('leaves removed host sessions in the actual store and across reload', async () => {
    const { dir, dataFile, store, invalidateTransport } = fixture()
    const removedHosts = []
    const remove = handlers.get('runtimeEnvironments:remove')
    expect(typeof remove).toBe('function')
    for (let index = 0; index < 32; index++) {
      const environment = pair(dir, `audit-${index}`)
      const hostId = toRuntimeExecutionHostId(environment.id)
      removedHosts.push(hostId)
      store.setWorkspaceSession(session(index), hostId)
      remove(null, { selector: environment.id })
    }
    await Promise.resolve()
    await Promise.resolve()
    expect(listEnvironments(dir)).toEqual([])
    expect(invalidateTransport).toHaveBeenCalledTimes(32)
    expect(store.getWorkspaceSessionHostIds().filter((id) => id !== 'local')).toEqual(removedHosts)
    store.flushOrThrow()
    const disk = JSON.parse(readFileSync(dataFile, 'utf8'))
    expect(Object.keys(disk.workspaceSessionsByHostId)).toHaveLength(32)
    const reloaded = new Store({ dataFile })
    try {
      expect(reloaded.getWorkspaceSessionHostIds().filter((id) => id !== 'local')).toEqual(
        removedHosts
      )
      for (let index = 0; index < 32; index++) {
        expect(
          Object.keys(reloaded.getWorkspaceSession(removedHosts[index]).tabsByWorktree)
        ).toEqual([`repo-a::/audit/${index}`])
      }
      writeFileSync(
        new URL('./results.json', import.meta.url),
        `${JSON.stringify(
          {
            cycles: 32,
            remainingEnvironments: 0,
            invalidatedTransports: invalidateTransport.mock.calls.length,
            inMemoryPartitions: removedHosts.length,
            persistedPartitions: Object.keys(disk.workspaceSessionsByHostId).length,
            persistedPartitionJsonBytes: Buffer.byteLength(
              JSON.stringify(disk.workspaceSessionsByHostId)
            ),
            reloadedPartitions: reloaded.getWorkspaceSessionHostIds().length - 1,
            limits:
              'Real Store and GUI IPC removal; seeded sessions, inert transport retirement and browser storage; no network, UI, native PTY, RSS or incident attribution.'
          },
          null,
          2
        )}\n`
      )
    } finally {
      reloaded.flush()
    }
  })
})
