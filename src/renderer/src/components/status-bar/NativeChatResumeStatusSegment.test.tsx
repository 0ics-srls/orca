// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { useAppStore } from '../../store'
import { TooltipProvider } from '../ui/tooltip'
import type { ResumeCandidate } from '../native-chat-resume-on-restart-grouping'
import {
  clearNativeChatResumeOnRestartCandidates,
  getNativeChatResumeOnRestartSnapshot,
  setNativeChatResumeOnRestartCandidates
} from '../native-chat-resume-on-restart-store'
import { NativeChatResumeStatusSegment } from './NativeChatResumeStatusSegment'

const candidates: ResumeCandidate[] = [
  {
    sessionId: 'a',
    workspaceId: 'workspace',
    agent: 'codex',
    trigger: 'quit',
    latestPrompt: 'Fix it',
    recordedAt: 1
  },
  {
    sessionId: 'b',
    workspaceId: 'workspace',
    agent: 'claude',
    trigger: 'update',
    latestPrompt: 'Review it',
    recordedAt: 2
  }
]

describe('NativeChatResumeStatusSegment', () => {
  beforeEach(() => {
    useAppStore.setState({
      ...useAppStore.getInitialState(),
      settings: { ...getDefaultSettings(''), experimentalStructuredNativeChat: true }
    })
    clearNativeChatResumeOnRestartCandidates()
  })

  afterEach(() => {
    cleanup()
    clearNativeChatResumeOnRestartCandidates()
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('shows the available count and reopens the dialog request', () => {
    setNativeChatResumeOnRestartCandidates(candidates)
    render(
      <TooltipProvider>
        <NativeChatResumeStatusSegment iconOnly={false} />
      </TooltipProvider>
    )

    expect(screen.getByRole('button', { name: '2 chats available to reconnect' })).toBeTruthy()
    expect(screen.getByText('2 chats to reconnect')).toBeTruthy()

    act(() => screen.getByRole('button').click())
    expect(getNativeChatResumeOnRestartSnapshot().openRequested).toBe(true)
  })

  it('hides when the feature is disabled or no candidates remain', () => {
    setNativeChatResumeOnRestartCandidates(candidates)
    useAppStore.setState({
      settings: { ...getDefaultSettings(''), experimentalStructuredNativeChat: false }
    })
    const { rerender } = render(
      <TooltipProvider>
        <NativeChatResumeStatusSegment iconOnly={false} />
      </TooltipProvider>
    )
    expect(screen.queryByRole('button')).toBeNull()

    useAppStore.setState({
      settings: { ...getDefaultSettings(''), experimentalStructuredNativeChat: true }
    })
    clearNativeChatResumeOnRestartCandidates()
    rerender(
      <TooltipProvider>
        <NativeChatResumeStatusSegment iconOnly={false} />
      </TooltipProvider>
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a compact count in icon-only mode', () => {
    setNativeChatResumeOnRestartCandidates(candidates)
    render(
      <TooltipProvider>
        <NativeChatResumeStatusSegment iconOnly />
      </TooltipProvider>
    )
    expect(screen.getByRole('button').textContent).toContain('2')
    expect(screen.queryByText('2 chats to reconnect')).toBeNull()
  })
})
