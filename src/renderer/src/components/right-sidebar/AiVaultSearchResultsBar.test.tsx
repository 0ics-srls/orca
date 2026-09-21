// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AiVaultSearchResultsBar } from './AiVaultSearchResultsBar'

afterEach(cleanup)

it('reports how many hits are shown and which order produced them', () => {
  const { rerender } = render(
    <AiVaultSearchResultsBar count={1} sort="relevance" onSortChange={vi.fn()} />
  )
  expect(screen.getByText('1 result')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sort results: Most relevant' })).toBeTruthy()

  rerender(<AiVaultSearchResultsBar count={20} sort="newest" onSortChange={vi.fn()} />)
  expect(screen.getByText('20 results')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sort results: Newest' })).toBeTruthy()
})

it('hands the picked order back to the caller', async () => {
  const onSortChange = vi.fn()
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  render(<AiVaultSearchResultsBar count={20} sort="relevance" onSortChange={onSortChange} />)

  await user.click(screen.getByRole('button', { name: 'Sort results: Most relevant' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'Newest' }))

  expect(onSortChange).toHaveBeenCalledExactlyOnceWith('newest')
})
