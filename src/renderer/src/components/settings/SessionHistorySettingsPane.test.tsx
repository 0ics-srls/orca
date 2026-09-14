// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { unavailableSessionSearchStatus } from '../../../../shared/ai-vault-search-client'
import type { AiVaultSearchStatus } from '../../../../shared/ai-vault-search-types'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { SessionHistorySettingsPane } from './SessionHistorySettingsPane'
import { SessionHistoryIndexStatus } from './SessionHistoryIndexStatus'

const mocks = vi.hoisted(() => ({ web: false, visible: true, status: vi.fn(), clear: vi.fn() }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => mocks.web }))
vi.mock('@/hooks/use-window-stream-visibility', () => ({
  useWindowStreamVisible: () => mocks.visible
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, args?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => String(args?.[key]))
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

function pane(
  enabled = false,
  confirm = vi.fn().mockResolvedValue(true),
  save = vi.fn().mockResolvedValue(undefined)
) {
  return render(
    <ConfirmationDialogContext.Provider value={confirm}>
      <SessionHistorySettingsPane
        settings={{
          ...getDefaultSettings('/synthetic'),
          aiVaultSearch: { enabled, historyDays: null }
        }}
        updateSettings={save}
      />
    </ConfirmationDialogContext.Provider>
  )
}
const current: AiVaultSearchStatus = {
  ...unavailableSessionSearchStatus(),
  enabled: true,
  phase: 'current',
  filesIndexed: 12
}
beforeEach(() => {
  vi.useFakeTimers()
  mocks.web = false
  mocks.visible = true
  mocks.status.mockReset().mockResolvedValue(current)
  mocks.clear.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('api', undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { aiVault: { searchStatus: mocks.status, clearSearchIndex: mocks.clear } }
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('requires opt-in and saves the existing policy without touching transcripts or polling while off', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  pane(false, undefined, save)
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByText(/Content is not redacted/)).toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(mocks.status).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.click(screen.getByRole('switch'))
  })
  expect(save).toHaveBeenCalledWith({ aiVaultSearch: { enabled: true, historyDays: null } })
})

it('shows failed saves inline and unlocks controls', async () => {
  pane(false, undefined, vi.fn().mockRejectedValue(new Error('write failed')))
  await act(async () => {
    fireEvent.click(screen.getByRole('switch'))
  })
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
  expect(screen.getByRole('switch')).toBeEnabled()
})

it('clears only after confirmation, supports clearing while disabled, and reports failures', async () => {
  const confirm = vi.fn().mockResolvedValue(false)
  pane(false, confirm)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Clear index' }))
  })
  expect(mocks.clear).not.toHaveBeenCalled()
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ description: expect.stringContaining('Search will stay off') })
  )
  confirm.mockResolvedValue(true)
  mocks.clear.mockRejectedValue(new Error('service unavailable'))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Clear index' }))
  })
  expect(mocks.clear).toHaveBeenCalledOnce()
  expect(screen.getByRole('alert')).toHaveTextContent('Could not clear')
})

it('does not execute a confirmation after navigating away', async () => {
  let accept: (value: boolean) => void = () => undefined
  const confirmation = new Promise<boolean>((resolve) => {
    accept = resolve
  })
  const view = pane(false, vi.fn().mockReturnValue(confirmation))
  fireEvent.click(screen.getByRole('button', { name: 'Clear index' }))
  view.unmount()
  await act(async () => {
    accept(true)
  })
  expect(mocks.clear).not.toHaveBeenCalled()
})

it('leaves paired-client controls unsupported without local calls', async () => {
  mocks.web = true
  pane(true)
  expect(screen.getByRole('switch')).toBeDisabled()
  expect(screen.getByRole('combobox')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Clear index' })).toBeDisabled()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(mocks.status).not.toHaveBeenCalled()
})

it('polls only observed indexing and stops at current, with explicit local ownership', async () => {
  mocks.status.mockResolvedValueOnce({ ...current, phase: 'indexing', filesDue: 4 })
  render(<SessionHistoryIndexStatus enabled refresh={0} busy={false} />)
  await act(async () => {})
  expect(screen.getByRole('status')).toHaveTextContent('Due: 4')
  expect(mocks.status).toHaveBeenCalledWith('local')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000)
  })
  expect(screen.getByRole('status')).toHaveTextContent('up to date with the last scan')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(mocks.status).toHaveBeenCalledTimes(2)
})

it('fences pending responses across disable, hiding and clear operations', async () => {
  let answer: (value: AiVaultSearchStatus) => void = () => undefined
  mocks.status.mockReturnValue(
    new Promise<AiVaultSearchStatus>((resolve) => {
      answer = resolve
    })
  )
  const view = render(<SessionHistoryIndexStatus enabled refresh={0} busy={false} />)
  view.rerender(<SessionHistoryIndexStatus enabled={false} refresh={0} busy={false} />)
  await act(async () => {
    answer(current)
  })
  expect(screen.getByRole('status')).toHaveTextContent('Search is off')
  expect(screen.queryByText(/Indexed files/)).not.toBeInTheDocument()
  mocks.visible = false
  view.rerender(<SessionHistoryIndexStatus enabled refresh={0} busy={false} />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(mocks.status).toHaveBeenCalledTimes(1)
  mocks.visible = true
  mocks.status.mockResolvedValue(current)
  view.rerender(<SessionHistoryIndexStatus enabled refresh={0} busy />)
  expect(mocks.status).toHaveBeenCalledTimes(1)
  view.rerender(<SessionHistoryIndexStatus enabled refresh={1} busy={false} />)
  await act(async () => {})
  expect(mocks.status).toHaveBeenCalledTimes(2)
})

it('does not describe an absent service as an empty current index and allows retry', async () => {
  mocks.status.mockResolvedValueOnce(unavailableSessionSearchStatus())
  render(<SessionHistoryIndexStatus enabled refresh={0} busy={false} />)
  await act(async () => {})
  expect(screen.getByRole('status')).toHaveTextContent(
    'not ready or the search service is unavailable'
  )
  expect(screen.queryByText(/Indexed files/)).not.toBeInTheDocument()
  mocks.status.mockRejectedValueOnce(new Error('offline'))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  })
  expect(screen.getByRole('status')).toHaveTextContent('Could not read index status')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  })
  expect(screen.getByRole('status')).toHaveTextContent('Indexed files: 12')
})

it('does not overlap slow status requests and cancels indexing refreshes on unmount', async () => {
  let answer: (value: AiVaultSearchStatus) => void = () => undefined
  mocks.status.mockReturnValue(
    new Promise<AiVaultSearchStatus>((resolve) => {
      answer = resolve
    })
  )
  const view = render(<SessionHistoryIndexStatus enabled refresh={0} busy={false} />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(mocks.status).toHaveBeenCalledTimes(1)
  await act(async () => {
    answer({ ...current, phase: 'indexing' })
  })
  view.unmount()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(mocks.status).toHaveBeenCalledTimes(1)
})

it('handles synchronous unavailable-bridge errors without leaving a refresh loop', async () => {
  mocks.status.mockImplementation(() => {
    throw new Error('bridge unavailable')
  })
  render(<SessionHistoryIndexStatus enabled refresh={0} busy={false} />)
  await act(async () => {})
  expect(screen.getByRole('status')).toHaveTextContent('Could not read index status')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(mocks.status).toHaveBeenCalledTimes(1)
})
