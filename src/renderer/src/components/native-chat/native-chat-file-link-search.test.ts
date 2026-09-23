import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findFileLinkSearchMatches, openFileLinkBySearch } from './native-chat-file-link-search'

type MockState = {
  activeWorktreeId: string | null
  worktreesByRepo: Record<string, { id: string; path: string }[]>
  getKnownWorktreeById: (id: string) => { repoId: string }
  openModal: (...args: unknown[]) => void
}

const mocks = vi.hoisted(() => {
  const openModal = vi.fn()
  const state: MockState = {
    activeWorktreeId: 'wt-1',
    worktreesByRepo: {},
    getKnownWorktreeById: () => ({ repoId: 'repo-1' }),
    openModal: (...args) => openModal(...args)
  }
  return {
    requestListing: vi.fn(),
    cancelListing: vi.fn(),
    openDetectedFilePath: vi.fn(),
    showNotFound: vi.fn(),
    showUnverifiable: vi.fn(),
    activate: vi.fn(),
    openModal,
    state
  }
})

vi.mock('@/components/quick-open-file-listing-request', () => ({
  requestQuickOpenFileListing: mocks.requestListing
}))
vi.mock('@/runtime/runtime-file-client', () => ({
  cancelRuntimeFileList: mocks.cancelListing
}))
vi.mock('@/components/terminal-pane/terminal-file-open-routing', () => ({
  getTerminalFileContext: () => ({ settings: null, worktreeId: 'wt-1', worktreePath: '/repo' }),
  openDetectedFilePath: mocks.openDetectedFilePath
}))
vi.mock('./native-chat-file-link-toasts', () => ({
  showFileLinkNotFoundToast: mocks.showNotFound,
  showFileLinkUnverifiableToast: mocks.showUnverifiable
}))
vi.mock('@/lib/browser-uuid', () => ({ createBrowserUuid: () => 'token-1' }))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorkspace: mocks.activate }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))

const context = { worktreeId: 'wt-1', worktreePath: '/repo', runtimeEnvironmentId: null }

function search(searchPath: string, signal = new AbortController().signal): Promise<void> {
  return openFileLinkBySearch({
    searchPath,
    line: 12,
    column: null,
    context,
    openWithSystemDefault: false,
    signal
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.activeWorktreeId = 'wt-1'
  mocks.state.worktreesByRepo = {}
})

describe('findFileLinkSearchMatches', () => {
  it('matches whole trailing path segments only', () => {
    const files = ['a/notes.md', 'b/my-notes.md', 'notes.md', 'c/docs/notes.md']
    expect(findFileLinkSearchMatches(files, 'notes.md')).toEqual([
      'a/notes.md',
      'notes.md',
      'c/docs/notes.md'
    ])
    expect(findFileLinkSearchMatches(files, 'docs/notes.md')).toEqual(['c/docs/notes.md'])
  })
})

describe('openFileLinkBySearch', () => {
  it('opens the only workspace file that ends with the link path', async () => {
    mocks.requestListing.mockResolvedValueOnce({
      files: ['marketing/events/deck/deck.md', 'marketing/events/deck/notes.md'],
      truncated: false
    })
    const signal = new AbortController().signal

    await search('deck.md', signal)

    expect(mocks.requestListing).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: '/repo' }),
      { query: 'deck.md', nameFilter: 'deck.md', requestToken: 'token-1', signal }
    )
    expect(mocks.openDetectedFilePath).toHaveBeenCalledWith(
      '/repo/marketing/events/deck/deck.md',
      12,
      null,
      expect.objectContaining({ worktreeId: 'wt-1', openWithSystemDefault: false })
    )
    expect(mocks.openModal).not.toHaveBeenCalled()
    expect(mocks.cancelListing).not.toHaveBeenCalled()
  })

  it('reports the matched file without searching again when it cannot be opened', async () => {
    mocks.requestListing.mockResolvedValue({ files: ['a/deck.md'], truncated: false })

    await search('deck.md')
    const { onOpenFailure } = mocks.openDetectedFilePath.mock.calls[0][3]
    onOpenFailure({ verdict: 'missing', error: new Error('ENOENT') })
    const unreachable = new Error('offline')
    onOpenFailure({ verdict: 'unverifiable', error: unreachable })

    expect(mocks.showNotFound).toHaveBeenCalledWith('/repo/a/deck.md')
    expect(mocks.showUnverifiable).toHaveBeenCalledWith('/repo/a/deck.md', unreachable)
    expect(mocks.requestListing).toHaveBeenCalledTimes(1)
  })

  it('offers Quick Open when several files match', async () => {
    mocks.requestListing.mockResolvedValueOnce({
      files: ['a/README.md', 'b/README.md'],
      truncated: false
    })

    await search('README.md')

    expect(mocks.openDetectedFilePath).not.toHaveBeenCalled()
    expect(mocks.openModal).toHaveBeenCalledWith('quick-open', { initialQuery: 'README.md' })
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('offers Quick Open in the link workspace when nothing matches or listing fails', async () => {
    mocks.state.activeWorktreeId = 'wt-other'
    mocks.requestListing.mockRejectedValueOnce(new Error('offline'))

    await search('missing.md')

    expect(mocks.activate).toHaveBeenCalledWith('wt-1')
    expect(mocks.openModal).toHaveBeenCalledWith('quick-open', { initialQuery: 'missing.md' })
  })

  it('excludes nested linked worktrees from the listing', async () => {
    mocks.state.worktreesByRepo = {
      'repo-1': [
        { id: 'wt-1', path: '/repo' },
        { id: 'wt-nested', path: '/repo/.worktrees/feature' }
      ]
    }
    mocks.requestListing.mockResolvedValueOnce({ files: [], truncated: false })

    await search('deck.md')

    expect(mocks.requestListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ excludePaths: ['/repo/.worktrees/feature'] })
    )
  })

  it('cancels the host scan and does nothing once a later click superseded this one', async () => {
    const controller = new AbortController()
    mocks.requestListing.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          controller.abort()
          resolve({ files: ['a/deck.md'], truncated: false })
        })
    )

    await search('deck.md', controller.signal)

    expect(mocks.cancelListing).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt-1' }),
      'token-1'
    )
    expect(mocks.openDetectedFilePath).not.toHaveBeenCalled()
    expect(mocks.openModal).not.toHaveBeenCalled()
  })

  it('does not cancel a scan that already settled', async () => {
    const controller = new AbortController()
    mocks.requestListing.mockResolvedValueOnce({ files: ['a/deck.md'], truncated: false })

    await search('deck.md', controller.signal)
    controller.abort()

    expect(mocks.cancelListing).not.toHaveBeenCalled()
  })
})
