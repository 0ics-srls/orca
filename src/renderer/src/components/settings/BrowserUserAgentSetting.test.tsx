// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../ui/tooltip'
import { BrowserUserAgentSetting } from './BrowserUserAgentSetting'

const identityGet = vi.fn()

describe('BrowserUserAgentSetting', () => {
  beforeEach(() => {
    identityGet.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { browser: { identityGet } }
    })
  })

  afterEach(cleanup)

  it('never substitutes the local identity while Remote Settings is focused', () => {
    identityGet.mockResolvedValue({
      identity: { configuredMode: 'native', appliedMode: 'native' },
      migrationNotice: null
    })

    render(
      <TooltipProvider>
        <BrowserUserAgentSetting hostId="runtime:remote-host" />
      </TooltipProvider>
    )

    expect(identityGet).not.toHaveBeenCalled()
    expect(screen.getByText(/manage browser identity on the remote host/i)).toBeTruthy()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })
})
