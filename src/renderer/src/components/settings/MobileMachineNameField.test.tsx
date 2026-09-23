// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type StoreState = {
  settings: { machineName: string } | null
  updateSettings: (patch: Record<string, unknown>) => Promise<void>
}

const mocks = vi.hoisted(() => {
  const holder: { state: StoreState } = { state: { settings: null, updateSettings: vi.fn() } }
  const useAppStore = Object.assign(
    (selector: (state: StoreState) => unknown) => selector(holder.state),
    { getState: () => holder.state }
  )
  return { holder, useAppStore, getStatus: vi.fn(), updateSettings: vi.fn() }
})

vi.mock('@/store', () => ({ useAppStore: mocks.useAppStore }))
vi.mock('../../store', () => ({ useAppStore: mocks.useAppStore }))

import { MobileMachineNameField } from './MobileMachineNameField'

function renderField(machineName: string) {
  mocks.holder.state = { settings: { machineName }, updateSettings: mocks.updateSettings }
  render(<MobileMachineNameField />)
  return { user: userEvent.setup() }
}

describe('MobileMachineNameField', () => {
  beforeEach(() => {
    mocks.getStatus.mockReset()
    mocks.updateSettings.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { runtime: { getStatus: mocks.getStatus } }
    })
  })

  afterEach(() => cleanup())

  it('shows the detected name as the blank default and lets the user set an override', async () => {
    mocks.getStatus.mockResolvedValue({ machineName: 'm4airs-Air' })
    const { user } = renderField('')

    expect(await screen.findByPlaceholderText('m4airs-Air')).toBeVisible()
    expect(
      screen.getByText(
        'Paired devices see “m4airs-Air”. Leave this blank to use the computer’s own name.'
      )
    ).toBeVisible()

    await user.type(screen.getByRole('textbox', { name: 'Machine name' }), 'build-server')
    await user.tab()
    expect(mocks.updateSettings).toHaveBeenCalledWith({ machineName: 'build-server' })
  })

  it('captions a saved override without asking the runtime, so a stale read cannot show the old name', async () => {
    // Why: the store only holds a saved value after main has written it, so it already is what
    // devices see. A runtime that still answers with the previous name must not win.
    mocks.getStatus.mockResolvedValue({ machineName: 'Brennan’s MacBook Pro' })
    renderField('QA Override Desk')
    await act(async () => {})

    expect(
      screen.getByText(
        'Paired devices see “QA Override Desk”. Leave this blank to use the computer’s own name.'
      )
    ).toBeVisible()
    expect(mocks.getStatus).not.toHaveBeenCalled()
  })
})
