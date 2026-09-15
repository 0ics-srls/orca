// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }))

vi.mock('@/store', () => ({ useAppStore: (selector: (state: object) => unknown) => selector({}) }))
vi.mock('@/lib/repo-runtime-owner', () => ({ getRuntimeEnvironmentIdForRepo: () => null }))
vi.mock('@/runtime/runtime-repo-client', () => ({
  getRuntimeRepoBaseRefDefault: async () => ({ defaultBaseRef: null, remoteCount: 0 }),
  searchRuntimeRepoBaseRefs: searchMock
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { BaseRefPicker } from './BaseRefPicker'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  searchMock.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

async function search(query: string): Promise<void> {
  await act(async () => root.render(<BaseRefPicker repoId="repo-1" onSelect={() => {}} />))
  const input = container.querySelector('input')
  if (!input) {
    throw new Error('branch search input missing')
  }
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter) {
      throw new Error('input value setter missing')
    }
    setter.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    vi.advanceTimersByTime(200)
    await Promise.resolve()
  })
}

describe('BaseRefPicker search verdict', () => {
  it('shows a failure rather than claiming no matching branches', async () => {
    searchMock.mockRejectedValue(new Error('remote Git unavailable'))
    await search('feature')

    expect(container.textContent).toContain('Branch discovery failed.')
    expect(container.textContent).not.toContain('No matching branches found.')
  })

  it('shows no matches only after an answered empty search', async () => {
    searchMock.mockResolvedValue([])
    await search('feature')

    expect(container.textContent).toContain('No matching branches found.')
    expect(container.textContent).not.toContain('Branch discovery failed.')
  })
})
