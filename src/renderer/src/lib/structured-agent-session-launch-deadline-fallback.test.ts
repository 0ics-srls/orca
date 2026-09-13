// @vitest-environment happy-dom

import { expect, it, vi } from 'vitest'
import type { StructuredAgentSessionLaunchIntent } from '@/lib/launch-structured-agent-session'
import type { StructuredAgentLaunchOptions } from './structured-agent-session-launch-callers'

const mocks = vi.hoisted(() => ({
  abandonIntent: vi.fn<(intent: StructuredAgentSessionLaunchIntent) => void>(),
  clearDraft: vi.fn<(sessionId: string) => void>(),
  createIntent:
    vi.fn<(worktreeId: string, agent: 'claude' | 'codex') => StructuredAgentSessionLaunchIntent>(),
  discardOutbox: vi.fn<(sessionId: string) => void>(),
  launch:
    vi.fn<
      (intent: StructuredAgentSessionLaunchIntent) => Promise<{ sessionId: string; fence: number }>
    >(),
  seedDraft:
    vi.fn<
      (sessionId: string, agent: 'claude' | 'codex', options: StructuredAgentLaunchOptions) => void
    >()
}))

vi.mock('@/lib/launch-structured-agent-session', () => {
  class StructuredAgentSessionCreateRefusalError extends Error {}
  return {
    abandonStructuredAgentSessionLaunchIntent: mocks.abandonIntent,
    createStructuredAgentSessionLaunchIntent: mocks.createIntent,
    StructuredAgentSessionCreateRefusalError
  }
})

vi.mock('@/lib/structured-agent-session-launch-recovery', () => ({
  launchAndReconcile: (state: { intent: StructuredAgentSessionLaunchIntent }) =>
    mocks.launch(state.intent),
  reconcileUnknownLaunch: vi.fn()
}))

vi.mock('@/components/native-chat/structured-agent-session-outbox-storage', () => ({
  discardStructuredAgentSessionLaunchOutbox: mocks.discardOutbox,
  enqueueStructuredAgentSessionLaunchPrompt: vi.fn(() => null)
}))

vi.mock('./structured-agent-session-launch-draft', () => ({
  clearStructuredAgentLaunchDraft: mocks.clearDraft,
  seedStructuredAgentLaunchDraft: mocks.seedDraft
}))

vi.mock('./structured-agent-session-launch-failure-toast', () => ({
  trackStructuredLaunchFailureToast: vi.fn()
}))

vi.mock('@/lib/structured-agent-session-launch-label', () => ({
  structuredAgentLabel: () => 'Codex'
}))

import { startStructuredAgentLaunch } from './structured-agent-session-launch'

it('abandons structured focus before a deadline fallback opens', async () => {
  const worktreeId = 'wt-deadline-fallback'
  const intent: StructuredAgentSessionLaunchIntent = {
    worktreeId,
    sessionId: 'deadline-session',
    agent: 'codex',
    params: {
      envelope: {
        sessionId: 'deadline-session',
        clientOperationId: 'operation-deadline-session',
        expectedRuntimeFence: null,
        payloadFingerprint: 'fingerprint-deadline-session'
      },
      worktree: `id:${worktreeId}`,
      agent: 'codex'
    }
  }
  mocks.createIntent.mockReturnValueOnce(intent)
  mocks.launch.mockImplementationOnce(() => new Promise(() => {}))
  const fallback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

  const launch = startStructuredAgentLaunch(worktreeId, 'codex', {
    prompt: 'review this',
    promptDelivery: 'draft'
  })

  await expect(launch.claimFallback(fallback, 'deadline')).resolves.toBe(true)
  expect(mocks.abandonIntent).toHaveBeenCalledWith(intent)
  expect(mocks.discardOutbox).toHaveBeenCalledWith(intent.sessionId)
  expect(mocks.clearDraft).toHaveBeenCalledWith(intent.sessionId)
  expect(fallback).toHaveBeenCalledOnce()
})
