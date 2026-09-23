// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePublishedMachineName } from './use-published-machine-name'

const getStatus = vi.fn()

beforeEach(() => {
  getStatus.mockReset()
  vi.stubGlobal('api', undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtime: { getStatus } }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('names what devices see after an override is saved, not what they saw on open', async () => {
  getStatus.mockResolvedValue({ machineName: 'Brennan’s MacBook Pro' })
  const view = renderHook(({ saved }) => usePublishedMachineName(saved), {
    initialProps: { saved: '' }
  })
  await act(async () => {})
  expect(view.result.current).toBe('Brennan’s MacBook Pro')

  getStatus.mockResolvedValue({ machineName: 'QA Override Desk' })
  view.rerender({ saved: 'QA Override Desk' })
  await act(async () => {})
  expect(view.result.current).toBe('QA Override Desk')

  getStatus.mockResolvedValue({ machineName: 'Brennan’s MacBook Pro' })
  view.rerender({ saved: '' })
  await act(async () => {})
  expect(view.result.current).toBe('Brennan’s MacBook Pro')
  expect(getStatus).toHaveBeenCalledTimes(3)
})

it('keeps the last known name when a status read fails', async () => {
  getStatus.mockResolvedValue({ machineName: 'build-server' })
  const view = renderHook(({ saved }) => usePublishedMachineName(saved), {
    initialProps: { saved: '' }
  })
  await act(async () => {})
  getStatus.mockRejectedValue(new Error('runtime starting'))
  view.rerender({ saved: 'renamed' })
  await act(async () => {})
  expect(view.result.current).toBe('build-server')
})
