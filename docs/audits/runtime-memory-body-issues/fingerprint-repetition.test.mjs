import { beforeEach, describe, expect, it, vi } from 'vitest'
const electronMocks = vi.hoisted(() => {
  const ipcMain = {
    on: vi.fn(() => ipcMain),
    removeListener: vi.fn(() => ipcMain),
    emit: vi.fn(() => true)
  }
  return {
    BrowserWindow: { fromId: vi.fn(() => null) },
    webContents: { fromId: vi.fn(() => null) },
    ipcMain,
    app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
  }
})
vi.mock('electron', () => electronMocks)
const getSshGitProviderMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock,
  getSshGitProviderGeneration: vi.fn(() => 0),
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE: 'unavailable',
  requireSshGitProvider: (connectionId) => getSshGitProviderMock(connectionId)
}))
const listWorktreesStrictMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/git/worktree', async (importOriginal) => ({
  ...(await importOriginal()),
  listWorktreesStrict: listWorktreesStrictMock
}))
const readRepoWorktreeAdminFingerprintMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/runtime/repo-worktree-admin-fingerprint', () => ({
  readRepoWorktreeAdminFingerprint: readRepoWorktreeAdminFingerprintMock
}))
import {
  OrcaRuntimeService,
  WORKTREE_SCAN_ADMIN_FINGERPRINT_TIMEOUT_MS
} from '../../../src/main/runtime/orca-runtime'
const REPO_ID = 'repo-local'
const REPO_PATH = '/Users/me/dev/app'
const WORKTREE_PATH = '/Users/me/dev/app-feature'
const WORKTREE_ID = `${REPO_ID}::${WORKTREE_PATH}`
const MAIN_WORKTREE_ID = `${REPO_ID}::${REPO_PATH}`
const SCAN_TTL_MS = 3e4
function makeMeta(overrides = {}) {
  return {
    displayName: 'feature',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}
function makeStore(options = {}) {
  const metaById = {
    [WORKTREE_ID]: makeMeta({
      hostId: 'local',
      instanceId: '11111111-1111-4111-8111-111111111111'
    }),
    [MAIN_WORKTREE_ID]: makeMeta({
      displayName: 'main',
      hostId: 'local',
      instanceId: '22222222-2222-4222-8222-222222222222'
    })
  }
  const basePath = options.repoPath ?? REPO_PATH
  const repos = Array.from({ length: options.repoCount ?? 1 }, (_unused, index) => ({
    id: index === 0 ? REPO_ID : `${REPO_ID}-${index}`,
    path: index === 0 ? basePath : `${basePath}-${index}`,
    displayName: 'app',
    badgeColor: 'blue',
    addedAt: 1,
    ...(options.connectionId === void 0 ? {} : { connectionId: options.connectionId })
  }))
  const store = {
    getRepo: (id) => store.getRepos().find((repo) => repo.id === id),
    getRepos: () => repos,
    getAllWorktreeMeta: () => metaById,
    getWorktreeMeta: (id) => metaById[id],
    setWorktreeMeta: (id, meta) => {
      metaById[id] = { ...(metaById[id] ?? makeMeta()), ...meta }
      return metaById[id]
    },
    removeWorktreeMeta: () => {},
    getAllWorktreeLineage: () => ({}),
    getAllWorkspaceLineage: () => ({}),
    removeWorktreeLineage: vi.fn(),
    removeWorkspaceLineage: vi.fn(),
    getGitHubCache: () => void 0,
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    }),
    getProjects: () => []
  }
  return store
}
function makeRuntime(options = {}) {
  const store = makeStore(options)
  const runtime = new OrcaRuntimeService(store)
  return {
    runtime,
    list: () => runtime.listResolvedWorktrees(),
    store
  }
}
function scanCount() {
  return listWorktreesStrictMock.mock.calls.length
}
async function drainMicrotasks() {
  for (let tick = 0; tick < 200; tick += 1) {
    await Promise.resolve()
  }
}
describe('issue 19312 finite slow fingerprint repetition', () => {
  beforeEach(() => {
    getSshGitProviderMock.mockReset()
    listWorktreesStrictMock.mockReset()
    listWorktreesStrictMock.mockResolvedValue([
      { path: REPO_PATH, head: 'abc', branch: 'main', isBare: false, isMainWorktree: true }
    ])
    readRepoWorktreeAdminFingerprintMock.mockReset()
    readRepoWorktreeAdminFingerprintMock.mockResolvedValue('fp-1')
  })
  it('repeats full scans for finite four-second probes despite unchanged contents', async () => {
    vi.useFakeTimers()
    try {
      const { list } = makeRuntime()
      await list()
      expect(scanCount()).toBe(1)
      for (let cycle = 0; cycle < 8; cycle++) {
        readRepoWorktreeAdminFingerprintMock.mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve('fp-1'), 4e3))
        )
        await vi.advanceTimersByTimeAsync(SCAN_TTL_MS + 1e3)
        const result = list()
        await drainMicrotasks()
        expect(scanCount()).toBe(cycle + 1)
        await vi.advanceTimersByTimeAsync(WORKTREE_SCAN_ADMIN_FINGERPRINT_TIMEOUT_MS)
        await result
        expect(scanCount()).toBe(cycle + 2)
        await vi.advanceTimersByTimeAsync(500)
      }
      expect(scanCount()).toBe(9)
      expect(readRepoWorktreeAdminFingerprintMock).toHaveBeenCalledTimes(9)
    } finally {
      vi.useRealTimers()
    }
  })
  it('returns to cache reuse when the next finite probe fits the deadline', async () => {
    vi.useFakeTimers()
    try {
      const { list } = makeRuntime()
      await list()
      for (const duration of [4e3, 3e3, 3e3]) {
        readRepoWorktreeAdminFingerprintMock.mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve('fp-1'), duration))
        )
        await vi.advanceTimersByTimeAsync(SCAN_TTL_MS + 1e3)
        const result = list()
        await vi.advanceTimersByTimeAsync(duration)
        await result
      }
      expect(scanCount()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
