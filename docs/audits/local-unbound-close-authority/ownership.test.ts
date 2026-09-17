import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../../src/main/persistence/loading-store/store'
import {
  createTestStore,
  seedStore,
  makeWorktree
} from '../../../src/renderer/src/store/slices/store-test-helpers'
import { createStoreCascadesMockApi } from '../../../src/renderer/src/store/slices/store-cascades-test-harness'
import { buildWorkspaceSessionPayload } from '../../../src/renderer/src/lib/workspace-session'
import { buildWorkspaceSessionPatch } from '../../../src/renderer/src/lib/workspace-session-patch'
import { advanceTerminalTopologyRevision } from '../../../src/main/runtime/workspace-session-terminal-membership-authority'
import type { WorkspaceSessionState } from '../../../src/shared/workspace-session-state-types'

const TAB = '11111111-1111-4111-8111-111111111111'
const LEAF = '22222222-2222-4222-8222-222222222222'
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) {
    fn()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture(
  kind: 'repo' | 'folder' = 'repo',
  host: 'local' | 'ssh:target' | 'runtime:other' = 'local'
) {
  const api = createStoreCascadesMockApi()
  const renderer = createTestStore()
  seedStore(renderer, {})
  const dir = mkdtempSync(join(tmpdir(), 'orca-unbound-close-'))
  const file = join(dir, 'orca-data.json')
  const main = new Store({ dataFile: file })
  const repo = { ...renderer.getState().repos[0], executionHostId: host }
  main.addRepo(repo)
  let worktree = `${repo.id}::/tmp/worktree`
  let folder
  if (kind === 'folder') {
    const group = main.createProjectGroup({
      name: 'Folder',
      parentPath: '/tmp/folder',
      createdFrom: 'manual'
    })
    folder = main.createFolderWorkspace({
      projectGroupId: group.id,
      folderPath: '/tmp/folder',
      connectionId: host === 'ssh:target' ? 'target' : null
    })
    folder = main.getFolderWorkspace(folder.id)!
    worktree = `folder:${folder.id}`
  }
  seedStore(renderer, {
    repos: [repo],
    activeRepoId: repo.id,
    activeWorktreeId: worktree,
    worktreesByRepo: {
      [repo.id]: [
        makeWorktree({ id: worktree, repoId: repo.id, path: '/tmp/worktree', hostId: host })
      ]
    },
    ...(folder ? { folderWorkspaces: [folder] } : {}),
    tabsByWorktree: { [worktree]: [] }
  })
  renderer.getState().createTab(worktree, undefined, undefined, { id: TAB, activate: false })
  main.setWorkspaceSession(
    advanceTerminalTopologyRevision(buildWorkspaceSessionPayload(renderer.getState()), worktree)
  )
  const hasTab = () =>
    main.getWorkspaceSession().tabsByWorktree[worktree].some((row) => row.id === TAB)
  const close = () => renderer.getState().closeTab(TAB)
  const save = () => main.setWorkspaceSession(buildWorkspaceSessionPayload(renderer.getState()))
  const mutate = (update: (session: WorkspaceSessionState) => WorkspaceSessionState) =>
    main.setWorkspaceSession(
      advanceTerminalTopologyRevision(update(main.getWorkspaceSession()), worktree)
    )
  const rows = (
    update: (
      row: WorkspaceSessionState['tabsByWorktree'][string][number]
    ) => WorkspaceSessionState['tabsByWorktree'][string][number]
  ) =>
    mutate((session) => ({
      ...session,
      tabsByWorktree: {
        ...session.tabsByWorktree,
        [worktree]: session.tabsByWorktree[worktree].map(update)
      }
    }))
  cleanup.push(() => {
    main.flush()
    rmSync(dir, { recursive: true, force: true })
  })
  return { api, renderer, main, file, worktree, hasTab, close, save, mutate, rows }
}

for (const kind of ['repo', 'folder'] as const) {
  for (const path of ['full', 'patch', 'marker-only', 'unload'] as const) {
    it(`retires exact empty ${kind} tab through ${path}`, () => {
      const f = fixture(kind)
      f.close()
      if (path === 'full') {
        f.save()
      }
      if (path === 'patch') {
        f.main.patchWorkspaceSession(
          buildWorkspaceSessionPatch(f.renderer.getState(), [
            'tabsByWorktree',
            'terminalLayoutsByTabId',
            'closedTerminalTabTombstonesByTabId'
          ])
        )
      }
      if (path === 'marker-only') {
        f.main.patchWorkspaceSession(
          buildWorkspaceSessionPatch(f.renderer.getState(), ['closedTerminalTabTombstonesByTabId'])
        )
      }
      if (path === 'unload') {
        f.main.stageWorkspaceSessionBeforeUnload(
          buildWorkspaceSessionPayload(f.renderer.getState())
        )
      }
      expect(f.hasTab()).toBe(false)
      f.main.flush()
      const restarted = new Store({ dataFile: f.file })
      expect(
        restarted.getWorkspaceSession().tabsByWorktree[f.worktree].some((row) => row.id === TAB)
      ).toBe(false)
      restarted.flush()
      expect(f.api.pty.kill).not.toHaveBeenCalled()
    })
  }
}

for (const change of [
  'pin',
  'unified-pin',
  'created-at',
  'generation',
  'bound-row',
  'new-leaf',
  'remote-binding',
  'incarnation'
] as const) {
  it(`protects host ${change} arriving before close save`, () => {
    const f = fixture()
    f.close()
    if (change === 'pin') {
      f.rows((row) => ({ ...row, isPinned: true }))
    }
    if (change === 'unified-pin') {
      f.mutate((session) => ({
        ...session,
        unifiedTabs: {
          [f.worktree]: session.unifiedTabs![f.worktree].map((row) => ({ ...row, isPinned: true }))
        }
      }))
    }
    if (change === 'created-at') {
      f.rows((row) => ({ ...row, createdAt: row.createdAt + 1 }))
    }
    if (change === 'generation') {
      f.rows((row) => ({ ...row, generation: 1 }))
    }
    if (change === 'bound-row') {
      f.rows((row) => ({ ...row, ptyId: 'pty-successor' }))
    }
    if (change === 'new-leaf') {
      f.mutate((session) => ({
        ...session,
        terminalLayoutsByTabId: {
          [TAB]: { root: { type: 'leaf', leafId: LEAF }, activeLeafId: LEAF, expandedLeafId: null }
        }
      }))
    }
    if (change === 'remote-binding') {
      f.mutate((session) => ({ ...session, remoteSessionIdsByTabId: { [TAB]: 'remote-session' } }))
    }
    if (change === 'incarnation') {
      f.mutate((session) => ({
        ...session,
        terminalPtyIncarnationsByPaneKey: { [`${TAB}:${LEAF}`]: 'new-incarnation' }
      }))
    }
    f.save()
    expect(f.hasTab()).toBe(true)
    expect(f.api.pty.kill).not.toHaveBeenCalled()
  })
}

it('legacy marker alone never authorizes local retirement', () => {
  const f = fixture()
  f.close()
  f.renderer.setState({
    closedTerminalTabTombstonesByTabId: { [TAB]: { closedAt: Date.now(), worktreeId: f.worktree } }
  })
  f.save()
  expect(f.hasTab()).toBe(true)
})

it('keeps prior refusal through old full write then unpin', () => {
  const f = fixture()
  f.close()
  f.rows((row) => ({ ...row, isPinned: true }))
  f.save()
  f.main.setWorkspaceSession({
    ...f.main.getWorkspaceSession(),
    closedTerminalTabTombstonesByTabId: undefined
  })
  f.rows((row) => ({ ...row, isPinned: false }))
  f.save()
  expect(f.hasTab()).toBe(true)
})

for (const host of ['ssh:target', 'runtime:other'] as const) {
  it(`does not mint local authority for ${host}`, () => {
    const f = fixture('repo', host)
    f.close()
    expect(
      f.renderer.getState().closedTerminalTabTombstonesByTabId[TAB]?.unboundLocalTab
    ).toBeUndefined()
    f.save()
    expect(f.hasTab()).toBe(true)
  })
}

it('does not reinterpret a refused marker after cap eviction and SSH acknowledgement', () => {
  const f = fixture()
  f.close()
  f.rows((row) => ({ ...row, isPinned: true }))
  f.save()
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 1_000)
  const newerSsh = Object.fromEntries(
    Array.from({ length: 500 }, (_, i) => [
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      { closedAt: now + 1 + i, worktreeId: 'ssh-repo::/path' }
    ])
  )
  f.main.patchWorkspaceSession({ closedTerminalTabTombstonesByTabId: newerSsh })
  expect(f.main.getWorkspaceSession().closedTerminalTabTombstonesByTabId?.[TAB]).toBeUndefined()
  f.main.patchWorkspaceSession({ closedTerminalTabTombstonesByTabId: {} })
  f.rows((row) => ({ ...row, isPinned: false }))
  f.save()
  expect(f.hasTab()).toBe(true)
})

if (process.env.ORCA_UNBOUND_RECEIPT === '1') {
  it('receipt survives persisted reload after transport marker removal', () => {
    const f = fixture()
    f.close()
    f.rows((row) => ({ ...row, isPinned: true }))
    f.save()
    const receipt =
      f.main.getWorkspaceSession().tabsByWorktree[f.worktree][0].rejectedLocalTabCloseAt
    expect(receipt).toBeTypeOf('number')
    f.main.patchWorkspaceSession({ closedTerminalTabTombstonesByTabId: {} })
    f.rows((row) => ({ ...row, isPinned: false }))
    f.main.flush()
    const restarted = new Store({ dataFile: f.file })
    expect(
      restarted.getWorkspaceSession().tabsByWorktree[f.worktree][0].rejectedLocalTabCloseAt
    ).toBe(receipt)
    restarted.setWorkspaceSession(buildWorkspaceSessionPayload(f.renderer.getState()))
    expect(
      restarted.getWorkspaceSession().tabsByWorktree[f.worktree].some((row) => row.id === TAB)
    ).toBe(true)
    restarted.flush()
  })

  it('old row metadata cannot erase host receipt', () => {
    const f = fixture()
    const old = buildWorkspaceSessionPayload(f.renderer.getState())
    f.close()
    f.rows((row) => ({ ...row, isPinned: true }))
    f.save()
    const receipt =
      f.main.getWorkspaceSession().tabsByWorktree[f.worktree][0].rejectedLocalTabCloseAt
    f.main.setWorkspaceSession(old)
    expect(f.main.getWorkspaceSession().tabsByWorktree[f.worktree][0].rejectedLocalTabCloseAt).toBe(
      receipt
    )
    f.save()
    expect(f.hasTab()).toBe(true)
  })

  it('a renderer cannot inject a receipt to block a future explicit close', () => {
    const f = fixture()
    f.rows((row) => ({ ...row, rejectedLocalTabCloseAt: Number.MAX_SAFE_INTEGER }))
    expect(
      f.main.getWorkspaceSession().tabsByWorktree[f.worktree][0].rejectedLocalTabCloseAt
    ).toBeUndefined()
    f.close()
    f.save()
    expect(f.hasTab()).toBe(false)
  })

  it('fresh explicit close can retire an unpinned tab after an earlier refusal', () => {
    const f = fixture()
    f.close()
    f.rows((row) => ({ ...row, isPinned: true }))
    f.save()
    const receipt =
      f.main.getWorkspaceSession().tabsByWorktree[f.worktree][0].rejectedLocalTabCloseAt!
    f.rows((row) => ({ ...row, isPinned: false }))
    f.renderer.setState({
      tabsByWorktree: f.main.getWorkspaceSession().tabsByWorktree,
      terminalLayoutsByTabId: f.main.getWorkspaceSession().terminalLayoutsByTabId
    })
    vi.spyOn(Date, 'now').mockReturnValue(receipt + 1)
    f.close()
    f.save()
    expect(f.hasTab()).toBe(false)
  })

  it('receipt remains after failed binding refusal later becomes unbound', () => {
    const f = fixture()
    f.close()
    f.rows((row) => ({ ...row, ptyId: 'pty-new' }))
    f.save()
    const receipt =
      f.main.getWorkspaceSession().tabsByWorktree[f.worktree][0].rejectedLocalTabCloseAt
    expect(receipt).toBeTypeOf('number')
    f.rows((row) => ({ ...row, ptyId: null }))
    f.save()
    expect(f.hasTab()).toBe(true)
  })

  it('receipt moves with original row and refuses delayed original-worktree close', () => {
    const f = fixture()
    const other = `${f.renderer.getState().repos[0].id}::/tmp/other`
    f.close()
    f.mutate((session) => ({
      ...session,
      tabsByWorktree: {
        [f.worktree]: [],
        [other]: session.tabsByWorktree[f.worktree].map((row) => ({ ...row, worktreeId: other }))
      }
    }))
    f.save()
    expect(
      f.main.getWorkspaceSession().tabsByWorktree[other][0].rejectedLocalTabCloseAt
    ).toBeTypeOf('number')
    f.mutate((session) => ({
      ...session,
      tabsByWorktree: {
        [other]: [],
        [f.worktree]: session.tabsByWorktree[other].map((row) => ({
          ...row,
          worktreeId: f.worktree
        }))
      }
    }))
    f.save()
    expect(f.hasTab()).toBe(true)
  })

  if (process.env.ORCA_UNBOUND_CLOCK_CASES !== '0') {
    for (const clock of ['same-millisecond', 'backwards', 'replacement'] as const) {
      it(`fresh explicit close remains possible with ${clock} clock or identity`, () => {
        const f = fixture()
        const now = Date.now()
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
        f.close()
        f.rows((row) => ({ ...row, isPinned: true }))
        f.save()
        f.rows((row) => ({
          ...row,
          isPinned: false,
          ...(clock === 'replacement' ? { createdAt: row.createdAt + 1 } : {})
        }))
        f.renderer.setState({
          tabsByWorktree: f.main.getWorkspaceSession().tabsByWorktree,
          terminalLayoutsByTabId: f.main.getWorkspaceSession().terminalLayoutsByTabId
        })
        nowSpy.mockReturnValue(clock === 'same-millisecond' ? now : now - 1_000)
        f.close()
        f.save()
        expect(f.hasTab()).toBe(false)
      })
    }
  }
}
