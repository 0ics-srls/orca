// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AiVaultShowMoreSessionsRow } from './AiVaultSessionLimitMenu'

afterEach(cleanup)

it('steps the history depth up by one page once the scan filled it', async () => {
  const onSessionLimitChange = vi.fn()
  render(
    <AiVaultShowMoreSessionsRow
      loaded={500}
      loading={false}
      sessionLimit={500}
      onSessionLimitChange={onSessionLimitChange}
    />
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show more sessions' }))
  expect(onSessionLimitChange).toHaveBeenCalledWith(750)
})

it('stays put in a loading state while the deeper rescan runs', () => {
  render(
    <AiVaultShowMoreSessionsRow
      loaded={250}
      loading
      sessionLimit={500}
      onSessionLimitChange={vi.fn()}
    />
  )
  const button = screen.getByRole('button', { name: 'Loading more sessions…' })
  expect(button.hasAttribute('disabled')).toBe(true)
})

it('stays hidden while the scan has room or is already unlimited', () => {
  render(
    <AiVaultShowMoreSessionsRow
      loaded={12}
      loading={false}
      sessionLimit={250}
      onSessionLimitChange={vi.fn()}
    />
  )
  render(
    <AiVaultShowMoreSessionsRow
      loaded={5000}
      loading={false}
      sessionLimit="unlimited"
      onSessionLimitChange={vi.fn()}
    />
  )
  expect(screen.queryByRole('button')).toBeNull()
})
