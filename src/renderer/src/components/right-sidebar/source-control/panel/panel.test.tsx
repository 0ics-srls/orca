// @vitest-environment happy-dom

import { useEffect } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { SourceControlPanel } from './panel'

const mocks = vi.hoisted(() => ({
  activeWorktree: vi.fn<() => Worktree | null>(),
  activeRepo: vi.fn<() => Repo | null>(),
  model: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn()
}))

vi.mock('@/store/selectors', () => ({
  useActiveWorktree: mocks.activeWorktree,
  useRepoById: mocks.activeRepo
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('./use-panel-model', () => ({
  useSourceControlPanelModel: () => {
    mocks.model()
    useEffect(() => {
      mocks.mount()
      return mocks.unmount
    }, [])
    return {
      activeWorktree: mocks.activeWorktree(),
      activeRepo: mocks.activeRepo(),
      worktreePath: mocks.activeWorktree()?.path ?? null,
      isFolder: mocks.activeRepo()?.kind === 'folder'
    }
  }
}))
vi.mock('./panel-ready', () => ({
  SourceControlPanelReady: ({ currentWorktreeId }: { currentWorktreeId: string }) => (
    <div>Git panel: {currentWorktreeId}</div>
  )
}))

const repo: Repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'Repo',
  badgeColor: 'blue',
  addedAt: 1
}
const worktree: Worktree = {
  id: 'repo-1::/repo',
  repoId: repo.id,
  path: repo.path,
  displayName: 'Repo',
  head: 'abc123',
  branch: 'main',
  isBare: false,
  isMainWorktree: true,
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.activeWorktree.mockReturnValue(worktree)
  mocks.activeRepo.mockReturnValue(repo)
})
afterEach(cleanup)

describe('SourceControlPanel workspace gate', () => {
  it.each(['no selection', 'missing repo', 'missing path', 'folder'])(
    'skips the Git model for %s',
    (state) => {
      if (state === 'no selection') {
        mocks.activeWorktree.mockReturnValue(null)
      }
      if (state === 'missing repo') {
        mocks.activeRepo.mockReturnValue(null)
      }
      if (state === 'missing path') {
        mocks.activeWorktree.mockReturnValue({ ...worktree, path: '' })
      }
      if (state === 'folder') {
        mocks.activeRepo.mockReturnValue({ ...repo, kind: 'folder' })
      }

      render(<SourceControlPanel />)

      expect(
        screen.getByText(
          state === 'folder'
            ? 'Source Control is only available for Git repositories'
            : 'Select a workspace to view changes'
        )
      ).toBeDefined()
      expect(mocks.model).not.toHaveBeenCalled()
      expect(mocks.mount).not.toHaveBeenCalled()
    }
  )

  it.each([undefined, 'git'] as const)('mounts Git repositories with kind %s', (kind) => {
    mocks.activeRepo.mockReturnValue({ ...repo, kind })
    render(<SourceControlPanel />)
    expect(screen.getByText(`Git panel: ${worktree.id}`)).toBeDefined()
    expect(mocks.mount).toHaveBeenCalledOnce()
  })

  it('cleans up on Git → folder and mounts again on folder → Git', () => {
    const { rerender } = render(<SourceControlPanel />)
    mocks.model.mockClear()
    mocks.activeRepo.mockReturnValue({ ...repo, kind: 'folder' })
    rerender(<SourceControlPanel />)

    expect(screen.getByText('Source Control is only available for Git repositories')).toBeDefined()
    expect(mocks.model).not.toHaveBeenCalled()
    expect(mocks.unmount).toHaveBeenCalledOnce()

    mocks.activeRepo.mockReturnValue(repo)
    rerender(<SourceControlPanel />)
    expect(screen.getByText(`Git panel: ${worktree.id}`)).toBeDefined()
    expect(mocks.mount).toHaveBeenCalledTimes(2)
  })

  it('keeps the Git model mounted when switching between Git worktrees', () => {
    const { rerender } = render(<SourceControlPanel />)
    mocks.activeWorktree.mockReturnValue({ ...worktree, id: 'repo-1::/repo/other' })
    rerender(<SourceControlPanel />)

    expect(screen.getByText('Git panel: repo-1::/repo/other')).toBeDefined()
    expect(mocks.mount).toHaveBeenCalledOnce()
    expect(mocks.unmount).not.toHaveBeenCalled()
  })
})
