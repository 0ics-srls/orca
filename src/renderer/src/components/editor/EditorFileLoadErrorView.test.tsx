// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorFileLoadErrorView } from './EditorFileLoadErrorView'

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
})
