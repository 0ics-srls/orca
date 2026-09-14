// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AgentCombobox from './AgentCombobox'
import { AGENT_CATALOG } from '@/lib/agent-catalog'
import { getAgentPickerAvailability } from '@/lib/agent-picker-availability'

afterEach(cleanup)

it.each([false, true])('explains unavailable OMP without launching it, disabled=%s', (disabled) => {
  const { available, unavailable } = getAgentPickerAvailability(
    AGENT_CATALOG,
    disabled ? ['omp'] : [],
    new Set(['pi'])
  )
  const select = vi.fn()
  const manage = vi.fn()
  render(
    <AgentCombobox
      agents={available}
      unavailableAgents={unavailable}
      value={null}
      onValueChange={select}
      onOpenManageAgents={manage}
    />
  )
  fireEvent.click(screen.getByRole('combobox'))
  fireEvent.change(screen.getByPlaceholderText('Search agents...'), { target: { value: 'omp' } })
  expect(screen.getByText('OMP')).toBeTruthy()
  expect(
    screen.getByText(
      disabled
        ? 'Disabled in Agents settings. Enable it in Manage agents.'
        : 'Not detected on the workspace host. Make sure omp is on that host’s PATH, then recheck in Manage agents.'
    )
  ).toBeTruthy()
  expect(screen.queryByRole('option', { name: 'OMP' })).toBeNull()
  fireEvent.keyDown(screen.getByPlaceholderText('Search agents...'), { key: 'Enter' })
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Manage agents' }))
  expect(manage).toHaveBeenCalledOnce()
})

it('keeps unknown search text as a normal no-match result', () => {
  const { available, unavailable } = getAgentPickerAvailability(AGENT_CATALOG, [], new Set(['pi']))
  render(
    <AgentCombobox
      agents={available}
      unavailableAgents={unavailable}
      value={null}
      onValueChange={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('combobox'))
  fireEvent.change(screen.getByPlaceholderText('Search agents...'), {
    target: { value: 'not-an-agent' }
  })
  expect(screen.getByText('No agents match your search.')).toBeTruthy()
  expect(screen.queryByText(/Not detected/)).toBeNull()
})
