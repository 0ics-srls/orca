// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import type { NativeChatFileLinkContext } from './native-chat-file-link'
import { useNativeChatFileLinkClick } from './use-native-chat-file-link-click'

const mocks = vi.hoisted(() => ({
  openDetectedFilePath: vi.fn(),
  showNotFound: vi.fn(),
  showUnverifiable: vi.fn(),
  showUnresolved: vi.fn(),
  openFileLinkBySearch: vi.fn()
}))

vi.mock('@/components/terminal-pane/terminal-file-open-routing', () => ({
  openDetectedFilePath: mocks.openDetectedFilePath
}))
vi.mock('./native-chat-file-link-search', () => ({
  openFileLinkBySearch: mocks.openFileLinkBySearch
}))
vi.mock('./native-chat-file-link-toasts', () => ({
  showFileLinkNotFoundToast: mocks.showNotFound,
  showFileLinkUnverifiableToast: mocks.showUnverifiable,
  showFileLinkUnresolvedToast: mocks.showUnresolved
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({}),
    { getState: () => ({ settings: {} }) }
  )
}))

const context: NativeChatFileLinkContext = {
  worktreeId: 'wt-1',
  worktreePath: '/repo',
  runtimeEnvironmentId: null
}

function Transcript(props: {
  markdown: string
  linkContext?: NativeChatFileLinkContext
}): React.JSX.Element {
  const onLinkClick = useNativeChatFileLinkClick(props.linkContext ?? context)
  return (
    <CommentMarkdown
      content={props.markdown}
      variant="document"
      onLinkClick={onLinkClick}
      allowFileUriLinks
      linkifyFilePaths
    />
  )
}

function clickLink(name: string): void {
  fireEvent.click(screen.getByRole('link', { name }))
}

function failLastOpen(
  verdict: 'missing' | 'unverifiable',
  error: unknown = new Error('x')
): AbortSignal {
  const signal = new AbortController().signal
  mocks.openDetectedFilePath.mock.calls.at(-1)?.[3].onOpenFailure({ verdict, error }, signal)
  return signal
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useNativeChatFileLinkClick', () => {
  it('searches the workspace when a bare file name is missing at the root', () => {
    render(<Transcript markdown="I updated `deck.md`." />)

    clickLink('deck.md')

    expect(mocks.openDetectedFilePath).toHaveBeenCalledWith(
      '/repo/deck.md',
      null,
      null,
      expect.objectContaining({ worktreeId: 'wt-1', onOpenFailure: expect.any(Function) })
    )
    const signal = failLastOpen('missing')
    expect(mocks.openFileLinkBySearch).toHaveBeenCalledWith(
      expect.objectContaining({ searchPath: 'deck.md', context, signal })
    )
    expect(mocks.showNotFound).not.toHaveBeenCalled()
  })

  it('reports a host that could not answer instead of searching or claiming absence', () => {
    render(<Transcript markdown="I updated `deck.md`." />)

    clickLink('deck.md')
    const error = new Error('SSH connection closed')
    failLastOpen('unverifiable', error)

    expect(mocks.showUnverifiable).toHaveBeenCalledWith('/repo/deck.md', error)
    expect(mocks.openFileLinkBySearch).not.toHaveBeenCalled()
    expect(mocks.showNotFound).not.toHaveBeenCalled()
  })

  it('reports a missing absolute path instead of searching for it', () => {
    render(<Transcript markdown="See `/repo/src/app.ts:12`." />)

    clickLink('/repo/src/app.ts:12')

    expect(mocks.openDetectedFilePath).toHaveBeenCalledWith(
      '/repo/src/app.ts',
      12,
      null,
      expect.anything()
    )
    failLastOpen('missing')
    expect(mocks.showNotFound).toHaveBeenCalledWith('/repo/src/app.ts')
    expect(mocks.openFileLinkBySearch).not.toHaveBeenCalled()
  })

  it('opens an explicit markdown link to a bare file name with a line', () => {
    render(<Transcript markdown="[the readme](README.md:5)" />)

    clickLink('the readme')

    expect(mocks.openDetectedFilePath).toHaveBeenCalledWith(
      '/repo/README.md',
      5,
      null,
      expect.anything()
    )
  })

  it('resolves URL syntax in explicit markdown links once', () => {
    render(<Transcript markdown="[plan](docs/plan.md#L7) and [notes](docs/release%20notes.md)" />)

    clickLink('plan')
    clickLink('notes')

    expect(mocks.openDetectedFilePath).toHaveBeenNthCalledWith(
      1,
      '/repo/docs/plan.md',
      7,
      null,
      expect.anything()
    )
    expect(mocks.openDetectedFilePath).toHaveBeenNthCalledWith(
      2,
      '/repo/docs/release notes.md',
      null,
      null,
      expect.anything()
    )
  })

  it('keeps # in a linked path instead of treating it as a fragment', () => {
    render(<Transcript markdown="Edit `My C# App/Program.cs` next." />)

    clickLink('My C# App/Program.cs')

    expect(mocks.openDetectedFilePath).toHaveBeenCalledWith(
      '/repo/My C# App/Program.cs',
      null,
      null,
      expect.anything()
    )
  })

  it('reports a link it cannot resolve without claiming the file is missing', () => {
    render(
      <Transcript
        markdown="Plan: `~/.claude/plans/plan.md`"
        linkContext={{ ...context, worktreePath: '/workspaces/repo' }}
      />
    )

    clickLink('~/.claude/plans/plan.md')

    expect(mocks.openDetectedFilePath).not.toHaveBeenCalled()
    expect(mocks.showUnresolved).toHaveBeenCalledWith('~/.claude/plans/plan.md')
    expect(mocks.showNotFound).not.toHaveBeenCalled()
  })
})
