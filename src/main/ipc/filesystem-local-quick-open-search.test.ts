import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handlers, store, resetFilesystemIpcMocks } from './filesystem-test-harness'

const { searchQuickOpenFilePathsMock, listQuickOpenFilesMock } = vi.hoisted(() => ({
  searchQuickOpenFilePathsMock: vi.fn(),
  listQuickOpenFilesMock: vi.fn()
}))

vi.mock('electron', async () => (await import('./filesystem-test-harness')).electronMock)
vi.mock('fs/promises', async () => (await import('./filesystem-test-harness')).fsPromisesMock)
vi.mock(
  '../wsl-unc-delete',
  async () => (await import('./filesystem-test-harness')).wslUncDeleteMock
)
vi.mock(
  '../crash-reporting/crash-breadcrumb-store',
  async () => (await import('./filesystem-test-harness')).crashBreadcrumbMock
)
vi.mock(
  '../local-downloaded-folder-promotion',
  async () => (await import('./filesystem-test-harness')).folderPromotionMock
)
vi.mock(
  '../git/status',
  async () => (await import('./filesystem-test-harness')).gitStatusModuleMock
)
vi.mock(
  '../git/check-ignored-paths',
  async () => (await import('./filesystem-test-harness')).gitIgnoredPathsMock
)
vi.mock('../git/worktree', async () => (await import('./filesystem-test-harness')).gitWorktreeMock)
vi.mock(
  '../providers/ssh-filesystem-dispatch',
  async () => (await import('./filesystem-test-harness')).sshFilesystemDispatchMock
)
vi.mock(
  '../providers/ssh-git-dispatch',
  async () => (await import('./filesystem-test-harness')).sshGitDispatchMock
)
vi.mock(
  '../text-generation/commit-message-text-generation',
  async () => (await import('./filesystem-test-harness')).textGenerationModuleMock
)
vi.mock(
  '../text-generation/pull-request-context',
  async () => (await import('./filesystem-test-harness')).pullRequestContextMock
)
vi.mock(
  '../source-control/pull-request-template',
  async () => (await import('./filesystem-test-harness')).pullRequestTemplateMock
)
vi.mock(
  '../source-control/pull-request-linked-issue',
  async () => (await import('./filesystem-test-harness')).pullRequestLinkedIssueMock
)
vi.mock('./filesystem-search-file-paths', () => ({
  searchQuickOpenFilePaths: searchQuickOpenFilePathsMock
}))
vi.mock('./filesystem-list-files', () => ({ listQuickOpenFiles: listQuickOpenFilesMock }))

import { registerFilesystemHandlers } from './filesystem'

function registerHandlers(): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handlers under test only read repos and settings from the harness store.
  registerFilesystemHandlers(store as never)
}

describe('fs:listFiles local name search', () => {
  beforeEach(() => {
    resetFilesystemIpcMocks()
    searchQuickOpenFilePathsMock.mockReset()
    listQuickOpenFilesMock.mockReset()
  })

  it('ranks the whole local workspace instead of filtering a capped listing', async () => {
    searchQuickOpenFilePathsMock.mockResolvedValue({
      paths: ['ios/AppDelegate.swift'],
      totalCount: 1,
      truncated: false
    })
    registerHandlers()

    await expect(
      handlers.get('fs:listFiles')!(null, {
        rootPath: '/repo',
        maxResults: 33,
        searchQuery: 'AppDelegate.swift'
      })
    ).resolves.toEqual(['ios/AppDelegate.swift'])

    expect(searchQuickOpenFilePathsMock).toHaveBeenCalledWith(
      '/repo',
      store,
      expect.objectContaining({ query: 'AppDelegate.swift', limit: 33 })
    )
    expect(listQuickOpenFilesMock).not.toHaveBeenCalled()
  })

  it('falls back to an uncapped listing when ripgrep is unavailable', async () => {
    listQuickOpenFilesMock.mockResolvedValue(['ios/AppDelegate.swift'])
    searchQuickOpenFilePathsMock.mockImplementation(
      async (_root, _store, args: { listWithoutRipgrep: () => Promise<string[]> }) => ({
        paths: await args.listWithoutRipgrep(),
        totalCount: 1,
        truncated: false
      })
    )
    registerHandlers()

    await handlers.get('fs:listFiles')!(null, { rootPath: '/repo', searchQuery: 'AppDelegate' })

    expect(listQuickOpenFilesMock).toHaveBeenCalledWith('/repo', store, undefined, undefined)
  })

  it('keeps plain local listings on the capped listing path', async () => {
    listQuickOpenFilesMock.mockResolvedValue(['src/a.ts'])
    registerHandlers()

    await handlers.get('fs:listFiles')!(null, { rootPath: '/repo', maxResults: 20_001 })

    expect(searchQuickOpenFilePathsMock).not.toHaveBeenCalled()
    expect(listQuickOpenFilesMock).toHaveBeenCalledWith(
      '/repo',
      store,
      undefined,
      undefined,
      20_001
    )
  })
})
