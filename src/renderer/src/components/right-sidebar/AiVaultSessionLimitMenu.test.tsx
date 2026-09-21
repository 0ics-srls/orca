// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AiVaultShowMoreSessionsRow } from './AiVaultSessionLimitMenu'

afterEach(cleanup)

it('steps the history depth up once the scan filled it', async () => {
  const onSessionLimitChange = vi.fn()
  render(
    <AiVaultShowMoreSessionsRow
      loaded={250}
      sessionLimit={250}
      onSessionLimitChange={onSessionLimitChange}
    />
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show more sessions' }))
  expect(onSessionLimitChange).toHaveBeenCalledWith(500)
})

it('stays hidden while the scan has room or is already unlimited', () => {
  render(
    <AiVaultShowMoreSessionsRow loaded={12} sessionLimit={250} onSessionLimitChange={vi.fn()} />
  )
  render(
    <AiVaultShowMoreSessionsRow
      loaded={5000}
      sessionLimit="unlimited"
      onSessionLimitChange={vi.fn()}
    />
  )
  expect(screen.queryByRole('button')).toBeNull()
})
