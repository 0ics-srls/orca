// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import {
  aiVaultBrowseSortAriaLabel,
  aiVaultBrowseSortOptions,
  aiVaultSearchSortAriaLabel,
  aiVaultSearchSortOptions
} from './ai-vault-sort-options'
import {
  AiVaultResultCountLabel,
  AiVaultSessionListBar,
  AiVaultShownCountLabel
} from './AiVaultSessionListBar'

afterEach(cleanup)

it('reports how many hits are shown and which order produced them', () => {
  const { rerender } = render(
    <AiVaultSessionListBar
      label={<AiVaultResultCountLabel count={1} />}
      value="relevance"
      options={aiVaultSearchSortOptions()}
      sortAriaLabel={aiVaultSearchSortAriaLabel}
      onChange={vi.fn()}
    />
  )
  expect(screen.getByText('1 result')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sort results: Most relevant' })).toBeTruthy()

  rerender(
    <AiVaultSessionListBar
      label={<AiVaultResultCountLabel count={20} />}
      value="newest"
      options={aiVaultSearchSortOptions()}
      sortAriaLabel={aiVaultSearchSortAriaLabel}
      onChange={vi.fn()}
    />
  )
  expect(screen.getByText('20 results')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sort results: Newest' })).toBeTruthy()
})

it('reports how much of the browsed history is shown and its order', () => {
  render(
    <AiVaultSessionListBar
      label={<AiVaultShownCountLabel shown={4} recent={12} />}
      value="created"
      options={aiVaultBrowseSortOptions()}
      sortAriaLabel={aiVaultBrowseSortAriaLabel}
      onChange={vi.fn()}
    />
  )
  expect(screen.getByText('4 shown · 12 recent')).toBeTruthy()
  expect(screen.getByText('4 shown')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sort sessions: Created' })).toBeTruthy()
})

it('hands the picked search order back to the caller', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  render(
    <AiVaultSessionListBar
      label={<AiVaultResultCountLabel count={20} />}
      value="relevance"
      options={aiVaultSearchSortOptions()}
      sortAriaLabel={aiVaultSearchSortAriaLabel}
      onChange={onChange}
    />
  )

  await user.click(screen.getByRole('button', { name: 'Sort results: Most relevant' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'Newest' }))

  expect(onChange).toHaveBeenCalledExactlyOnceWith('newest')
})

it('hands the picked browse order back to the caller', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  render(
    <AiVaultSessionListBar
      label={<AiVaultShownCountLabel shown={4} recent={12} />}
      value="updated"
      options={aiVaultBrowseSortOptions()}
      sortAriaLabel={aiVaultBrowseSortAriaLabel}
      onChange={onChange}
    />
  )

  await user.click(screen.getByRole('button', { name: 'Sort sessions: Last updated' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'Created' }))

  expect(onChange).toHaveBeenCalledExactlyOnceWith('created')
})
