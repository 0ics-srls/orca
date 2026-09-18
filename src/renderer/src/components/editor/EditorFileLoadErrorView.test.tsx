// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorFileLoadErrorView } from './EditorFileLoadErrorView'
import {
  WORKTREE_HOST_UNRESOLVED_CODE,
  WORKTREE_HOST_UNRESOLVED_ERROR
} from './editor-panel-content-types'

describe('EditorFileLoadErrorView', () => {
  afterEach(cleanup)

  it('offers Close only when the caller can route it, and never closes on its own', () => {
    const onRetry = vi.fn()
    const onClose = vi.fn()

    render(
      <EditorFileLoadErrorView message="selector_not_found" onRetry={onRetry} onClose={onClose} />
    )

    screen.getByText('selector_not_found')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders no Close action without a handler', () => {
    render(<EditorFileLoadErrorView message="ENOENT" onRetry={vi.fn()} />)

    screen.getByRole('button', { name: 'Retry' })
    expect(screen.queryByRole('button', { name: 'Close tab' })).toBeNull()
  })

  it('localizes the host-unresolved state by its sentinel code, not by the stored text', () => {
    // Why: the stored `loadError` is an English fallback; the code is what selects the
    // localized copy, so a translated catalog cannot desynchronize from the comparison.
    render(
      <EditorFileLoadErrorView
        message="stored fallback text"
        code={WORKTREE_HOST_UNRESOLVED_CODE}
        onRetry={vi.fn()}
      />
    )

    screen.getByText(WORKTREE_HOST_UNRESOLVED_ERROR)
    expect(screen.queryByText('stored fallback text')).toBeNull()
  })
})
