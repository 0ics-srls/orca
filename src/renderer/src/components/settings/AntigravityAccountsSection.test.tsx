// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.hoisted(() => vi.fn())

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('../ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) =>
    React.createElement('button', props, children)
}))

vi.mock('../status-bar/icons', () => ({
  GeminiIcon: () => React.createElement('span', { 'data-testid': 'gemini-icon' })
}))

import { AntigravityAccountsSection } from './AntigravityAccountsSection'

describe('AntigravityAccountsSection', () => {
  beforeEach(() => {
    list.mockResolvedValue({
      accounts: [],
      activeAccountId: null,
      detectedAccount: {
        id: 'antigravity-detected',
        email: 'detected@example.com',
        subject: 'subject',
        authMethod: 'consumer'
      }
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { antigravityAccounts: { list } }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows a detected account before explicit vault save', async () => {
    render(<AntigravityAccountsSection quota={null} />)

    expect(await screen.findByText('detected@example.com')).toBeInTheDocument()
    expect(
      screen.getByText('Detected on this computer; add it to enable switching')
    ).toBeInTheDocument()
    expect(screen.getByText('Add current agy account')).toBeInTheDocument()
  })
})
