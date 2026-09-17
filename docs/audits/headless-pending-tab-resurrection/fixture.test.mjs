import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDefaultWorkspaceSession } from '../../../src/shared/constants'
import { Store } from '../../../src/main/persistence/loading-store/store'
import { OrcaRuntimeService } from '../../../src/main/runtime/orca-runtime'
import { setRuntimeDesktopSurface } from '../../../src/main/runtime/runtime-desktop-surface'
import { SESSION_TAB_CLOSE_METHODS } from '../../../src/main/runtime/rpc/methods/session-tab-close-methods'
import { spawnPtyFromRuntimeController } from '../../../src/main/ipc/pty/runtime/spawn'
import { adoptStablePane } from '../../../src/main/ipc/pty/pane/adopt-stable'
import {
  claimRuntimePaneCreate,
  makePaneSpawnReservationKey
} from '../../../src/main/ipc/pty/pane/spawn-reservation'
import * as providerRegistry from '../../../src/main/ipc/pty/provider/registry'
import * as hostEnv from '../../../src/main/ipc/pty/host-env/assembly'
import { clearProviderPtyState } from '../../../src/main/ipc/pty/provider/state-cleanup'
import { ptyOwnership } from '../../../src/main/ipc/pty/provider/ownership-state'

const WT = 'review-repo::/tmp/issue-21066'
const TAB = '11111111-1111-4111-8111-111111111111'
const LEAF = '22222222-2222-4222-8222-222222222222'
const INC = '33333333-3333-4333-8333-333333333333'
const PTY = `${WT}@@review-session`
const cleanups = []

afterEach(() => {
  vi.restoreAllMocks()
  clearProviderPtyState(PTY)
  ptyOwnership.delete(PTY)
  for (const dispose of cleanups.splice(0)) {
    dispose()
  }
  setRuntimeDesktopSurface(null)
})

function createFixture(killValue = false, connected = true, bound = true) {
  const directory = mkdtempSync(join(tmpdir(), 'orca-21066-'))
  const dataFile = join(directory, 'orca-data.json')
  const store = new Store({ dataFile })
  store.addRepo({
    id: 'review-repo',
    path: '/tmp/issue-21066',
    displayName: 'Review',
    badgeColor: 'gray',
    addedAt: 1
  })
  store.setWorkspaceSession({
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: {
      [WT]: [
        {
          id: TAB,
          worktreeId: WT,
          ptyId: bound ? PTY : null,
          title: 'Review',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    },
    terminalLayoutsByTabId: {
      [TAB]: {
        root: { type: 'leaf', leafId: LEAF },
        activeLeafId: LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: bound ? { [LEAF]: PTY } : {}
      }
    },
    terminalPtyIncarnationsByPaneKey: bound ? { [`${TAB}:${LEAF}`]: INC } : {}
  })
  store.flushOrThrow()
  const original = structuredClone(store.getWorkspaceSession())
  const runtime = new OrcaRuntimeService(store)
  setRuntimeDesktopSurface(null)
  const worktree = {
    id: WT,
    repoId: 'review-repo',
    path: '/tmp/issue-21066',
    branch: 'main',
    isMain: true,
    connectionId: null,
    hostId: 'local'
  }
  vi.spyOn(runtime, 'computeResolvedWorktrees').mockResolvedValue({
    worktrees: [worktree],
    platformByRepoId: new Map([['review-repo', 'linux']])
  })
  const kill = vi.fn(() => killValue)
  const live = { enabled: connected, id: PTY }
  const controller = {
    write: () => true,
    kill,
    getForegroundProcess: async () => null,
    listProcesses: async () =>
      live.enabled ? [{ id: live.id, cwd: worktree.path, title: 'Review', incarnationId: INC }] : []
  }
  runtime.setPtyController(controller)
  runtime.syncWindowGraph(0, { tabs: [], leaves: [] })
  if (connected) {
    runtime.registerPty(PTY, WT, null, { tabId: TAB, leafId: LEAF, incarnationId: INC })
    runtime.ptysById.get(PTY).runtimeSessionOwned = true
    runtime.pairedRendererSessionOwnedPtyIds.add(PTY)
  }
  cleanups.push(() => {
    runtime.setPtyController(null)
    clearProviderPtyState(live.id)
    ptyOwnership.delete(live.id)
    store.flush()
    rmSync(directory, { recursive: true, force: true })
  })
  return { runtime, store, original, kill, dataFile, controller, live }
}

async function mobileClose(runtime) {
  const method = SESSION_TAB_CLOSE_METHODS.find(
    (candidate) => candidate.name === 'session.tabs.close'
  )
  return method.handler(
    { worktree: `id:${WT}`, tabId: `${TAB}::${LEAF}`, reason: 'user' },
    { runtime, clientKind: 'mobile' }
  )
}

it.each([false, true])(
  'mobile headless close durably retires even when kill returns %s and live inventory remains',
  async (killValue) => {
    const f = createFixture(killValue)
    expect((await f.runtime.listMobileSessionTabs(`id:${WT}`)).tabs).toHaveLength(1)
    await expect(mobileClose(f.runtime)).resolves.toEqual({ closed: true })
    expect(f.kill).toHaveBeenCalledWith(PTY)
    expect(f.store.getWorkspaceSession().tabsByWorktree[WT]).toEqual([])
    expect(new Store({ dataFile: f.dataFile }).getWorkspaceSession().tabsByWorktree[WT]).toEqual([])
    for (let index = 0; index < 3; index++) {
      await f.runtime.activateManagedWorktree(`id:${WT}`, {
        clientKind: 'mobile',
        navigation: 'caller',
        notifyClients: false
      })
      expect((await f.runtime.listMobileSessionTabs(`id:${WT}`)).tabs).toEqual([])
    }
    const listed = await f.runtime.listTerminals(`id:${WT}`)
    expect(listed.terminals).toHaveLength(1)
    expect(listed.terminals[0]).toMatchObject({ connected: true, orphaned: false })
    f.runtime.mobileSessionTabsByWorktree.clear()
    expect((await f.runtime.listMobileSessionTabs(`id:${WT}`)).tabs).toEqual([])
  }
)

it('rejects stale persisted-tab replay after successful headless close', async () => {
  const f = createFixture()
  await mobileClose(f.runtime)
  f.store.setWorkspaceSession(f.original)
  f.store.flushOrThrow()
  expect(f.store.getWorkspaceSession().tabsByWorktree[WT]).toEqual([])
  const reloaded = new Store({ dataFile: f.dataFile })
  expect(reloaded.getWorkspaceSession().tabsByWorktree[WT]).toEqual([])
  f.runtime.mobileSessionTabsByWorktree.clear()
  expect((await f.runtime.listMobileSessionTabs(`id:${WT}`)).tabs).toEqual([])
})

it('propagates disk failure before kill and leaves original disk row for restart', async () => {
  const f = createFixture()
  const diskBefore = readFileSync(f.dataFile, 'utf8')
  vi.spyOn(f.store, 'flushOrThrow').mockImplementation(() => {
    throw new Error('controlled disk failure')
  })
  await expect(mobileClose(f.runtime)).rejects.toThrow('controlled disk failure')
  expect(f.kill).not.toHaveBeenCalled()
  expect(readFileSync(f.dataFile, 'utf8')).toBe(diskBefore)
  expect(new Store({ dataFile: f.dataFile }).getWorkspaceSession().tabsByWorktree[WT]).toHaveLength(
    1
  )
})

const activationCases = [false, true].flatMap((bound) =>
  ['close', 'keep', 'replacement', 'failure'].map((action) => ({ bound, action }))
)

it.each(activationCases)(
  'pending activation with bound=$bound and action=$action',
  async ({ bound, action }) => {
    const f = createFixture(false, false, bound)
    const entered = Promise.withResolvers()
    const completion = Promise.withResolvers()
    let spawnedId
    const provider = {
      async spawn(options) {
        expect(options.attachOnly === true).toBe(bound)
        spawnedId = options.sessionId
        expect(typeof spawnedId).toBe('string')
        f.live.id = spawnedId
        entered.resolve()
        await completion.promise
        if (action === 'failure') {
          throw new Error('controlled provider failure')
        }
        f.live.enabled = true
        return { id: spawnedId, incarnationId: INC, ...(bound ? { isReattach: true } : {}) }
      },
      shutdown() {
        throw new Error('Unexpected cleanup in fixture')
      }
    }
    vi.spyOn(providerRegistry, 'getProvider').mockReturnValue(provider)
    vi.spyOn(hostEnv, 'buildPtyHostEnv').mockImplementation((_session, env) => env)
    f.controller.adoptStablePane = (args) => adoptStablePane(f.runtime, f.store, args)
    f.controller.claimStablePaneCreate = (args) =>
      claimRuntimePaneCreate(
        makePaneSpawnReservationKey(
          args.worktreeId,
          args.connectionId,
          `${args.tabId}:${args.leafId}`
        )
      )
    const deps = {
      store: f.store,
      runtime: f.runtime,
      trustedTerminalHandleEnv: new Set(),
      adoptStablePane: f.controller.adoptStablePane,
      getLocalPtyStartupPromise() {},
      getLocalPtyProviderStartupPromise() {},
      assertFolderWorkspacePtyPathUsable() {},
      resolvePtySpawnStartupCwd: (_worktree, cwd) => cwd,
      prepareCodexResumeHome: () => null,
      noCodexResumeLaunch: (command) => ({ command, codexResumeHome: null }),
      stripSequencedStartupResumeArgv: (env) => env,
      sendPtySpawnedToRenderer() {}
    }
    f.controller.spawn = (args) => {
      expect(args.tabId).toBe(TAB)
      expect(args.leafId).toBe(LEAF)
      expect(args.persistHostSessionBinding).toBe(true)
      return spawnPtyFromRuntimeController(deps, args)
    }
    const opening = f.runtime.activateMobileSessionTab(`id:${WT}`, `${TAB}::${LEAF}`, undefined, {
      navigation: 'caller'
    })
    const settled = opening.then(
      (value) => ({ value }),
      (error) => ({ error })
    )
    try {
      await entered.promise
      if (action !== 'keep') {
        await expect(mobileClose(f.runtime)).resolves.toEqual({ closed: true })
        expect(f.store.getWorkspaceSession().tabsByWorktree[WT]).toEqual([])
        expect(
          new Store({ dataFile: f.dataFile }).getWorkspaceSession().tabsByWorktree[WT]
        ).toEqual([])
      }
      const replacementId = `${WT}@@replacement`
      if (action === 'replacement') {
        expect(
          f.store.persistPtyBinding({
            worktreeId: WT,
            tabId: TAB,
            leafId: LEAF,
            ptyId: replacementId,
            incarnationId: '44444444-4444-4444-8444-444444444444',
            hostAdmittedMembership: true
          })
        ).toBe(true)
      }
      completion.resolve()
      const result = await settled
      if (action === 'failure') {
        expect(result.error?.message).toBe('controlled provider failure')
      } else if (bound && action !== 'keep') {
        expect(result.error?.message).toBe('terminal_pane_owner_changed')
      } else {
        expect(result.error).toBeUndefined()
      }
      const count = action === 'failure' || (bound && action === 'close') ? 0 : 1
      expect(f.store.getWorkspaceSession().tabsByWorktree[WT]).toHaveLength(count)
      const reloaded = new Store({ dataFile: f.dataFile }).getWorkspaceSession()
      expect(reloaded.tabsByWorktree[WT]).toHaveLength(count)
      if (action === 'replacement') {
        expect(reloaded.terminalLayoutsByTabId[TAB].ptyIdsByLeafId[LEAF]).toBe(
          bound ? replacementId : spawnedId
        )
      } else {
        expect((await f.runtime.listMobileSessionTabs(`id:${WT}`)).tabs).toHaveLength(count)
      }
      expect(deps.trustedTerminalHandleEnv.size).toBe(0)
    } finally {
      completion.resolve()
      await settled
    }
  }
)
