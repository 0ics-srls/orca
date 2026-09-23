// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import QuickOpen from './QuickOpen'

vi.mock('@/components/quick-open-file-list', () => ({
  useRuntimeFileListForWorktree: () => ({
    files: [],
    loading: false,
    loadError: null,
    truncated: false
  })
}))

vi.mock('@/hooks/useModalReturnFocus', () => ({
  useModalReturnFocus: () => ({ captureReturnFocus: vi.fn(), skipReturnFocus: vi.fn() })
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/components/ui/command', () => ({
  CommandDialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  CommandInput: ({ value }: { value: string }) => (
    <input data-command-input="true" value={value} readOnly />
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandItem: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

const initialAppState = useAppStore.getInitialState()
let testContainer: HTMLDivElement
let testRoot: Root

function inputValue(): string | null {
  return testContainer.querySelector<HTMLInputElement>('[data-command-input="true"]')?.value ?? null
}

describe('QuickOpen initial query', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    useAppStore.setState(initialAppState, true)
    testContainer = document.createElement('div')
    document.body.appendChild(testContainer)
    testRoot = createRoot(testContainer)
  })

  afterEach(async () => {
    await act(async () => testRoot.unmount())
    document.body.replaceChildren()
    useAppStore.setState(initialAppState, true)
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('seeds the input from modal data and starts empty again on a plain reopen', async () => {
    await act(async () => testRoot.render(<QuickOpen />))
    await act(async () =>
      useAppStore.getState().openModal('quick-open', { initialQuery: 'deck.md' })
    )

    expect(inputValue()).toBe('deck.md')

    // Reopened while the closed dialog still lingers: the mounted input must reset.
    await act(async () => useAppStore.getState().closeModal())
    await act(async () => useAppStore.getState().openModal('quick-open'))
    expect(inputValue()).toBe('')

    // A seed arriving while the palette is already open (a slow search settling after
    // Cmd+P) must still land in the input.
    await act(async () =>
      useAppStore.getState().openModal('quick-open', { initialQuery: 'notes.md' })
    )
    expect(inputValue()).toBe('notes.md')

    // Reopened after the linger unmounted it: a fresh mount must not remember the seed.
    await act(async () => useAppStore.getState().closeModal())
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(inputValue()).toBeNull()
    await act(async () => useAppStore.getState().openModal('quick-open'))
    expect(inputValue()).toBe('')
  })
})
