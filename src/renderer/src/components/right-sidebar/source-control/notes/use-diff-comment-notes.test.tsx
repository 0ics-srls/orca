// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../../../../shared/diff-comment-types'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  writeClipboardText: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError, message: vi.fn() } }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({})
}))
vi.mock('@/store/worktree-diff-comments-selector', () => ({
  selectWorktreeDiffCommentsOrEmpty: () => [
    { id: 'c1', filePath: 'src/app.ts', body: 'rename this' } as unknown as DiffComment
  ]
}))

import { useSourceControlDiffCommentNotes } from './use-diff-comment-notes'

function renderNotes() {
  return renderHook(() =>
    useSourceControlDiffCommentNotes({
      activeWorktreeId: 'wt-1',
      clearDiffComments: async () => true,
      clearDiffCommentsForFile: async () => true
    })
  )
}

describe('diff-comment notes copy failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { api: { ui: { writeClipboardText: mocks.writeClipboardText } } })
  })

  it('never shows "Copied" for a clipboard write that rejected', async () => {
    mocks.writeClipboardText.mockRejectedValue(
      new Error("Error invoking remote method 'ui:writeClipboardText': Error: payload too large")
    )
    const { result } = renderNotes()

    await act(async () => {
      await result.current.handleCopyDiffComments()
    })

    expect(result.current.diffCommentsCopied).toBe(false)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    const [title, options] = mocks.toastError.mock.calls[0] as [string, { description?: string }]
    expect(title).toBe('Failed to copy notes')
    expect(options.description).toBe('payload too large')
  })

  it('stays silent when the write resolves', async () => {
    mocks.writeClipboardText.mockResolvedValue(undefined)
    const { result } = renderNotes()

    await act(async () => {
      await result.current.handleCopyDiffComments()
    })

    expect(result.current.diffCommentsCopied).toBe(true)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
