import { describe, expect, it, vi } from 'vitest'
import { createAgentCompletionCoordinator } from './agent-completion-coordinator'
import { useAgentCompletionCoordinatorLifecycle } from './agent-completion-coordinator-test-harness'

describe('agent completion coordinator Grok announceability', () => {
  useAgentCompletionCoordinatorLifecycle()

  // Pins notification-controller.ts ordinary hook dispatch metadata; dropping the accepted snapshot or completionIdentity must redden.
  it('dispatches an explicit accepted Stop with its immutable snapshot and dedupe identity', () => {
    const dispatchCompletion = vi.fn()
    const coordinator = createAgentCompletionCoordinator({
      paneKey: 'tab-1:leaf-1',
      getPtyId: () => 'pty-1',
      getSettings: () => null,
      inspectProcess: vi.fn(),
      dispatchCompletion,
      isLive: () => true
    })
    const acceptedStop = {
      state: 'done' as const,
      prompt: 'finish the request',
      agentType: 'grok',
      completionOutcome: 'succeeded' as const,
      announceCompletion: true,
      lastAssistantMessage: 'Final answer.',
      stateStartedAt: 2_000
    }

    coordinator.observeHookStatus(acceptedStop)
    coordinator.observeHookStatus({
      state: 'working',
      prompt: 'later work',
      agentType: 'grok',
      stateStartedAt: 3_000
    })

    expect(dispatchCompletion).toHaveBeenCalledTimes(1)
    expect(dispatchCompletion).toHaveBeenCalledWith('grok', {
      source: 'hook',
      quietedHookDone: false,
      agentStatus: acceptedStop,
      completionIdentity: {
        source: 'hook',
        identity: 'done:grok:2000',
        agentIdentity: 'grok'
      }
    })
  })

  // Pins hook-observer.ts suppressNotification dispatch and notification-controller.ts identity commit; returning before that commit must redden on remount.
  it('records a silent Stop identity so the same observation cannot revive later', () => {
    const dispatchCompletion = vi.fn()
    const dispatchHookLifecycle = vi.fn()
    const options = {
      paneKey: 'tab-1:leaf-1',
      statusLane: 'hook' as const,
      getPtyId: () => 'pty-1',
      getSettings: () => null,
      inspectProcess: vi.fn(),
      dispatchCompletion,
      dispatchHookLifecycle,
      isLive: () => true
    }
    const first = createAgentCompletionCoordinator(options)
    first.observeHookStatus({
      state: 'working',
      prompt: 'start background work',
      agentType: 'grok',
      stateStartedAt: 1_000
    })
    first.observeHookStatus({
      state: 'done',
      prompt: 'start background work',
      agentType: 'grok',
      completionOutcome: 'succeeded',
      announceCompletion: false,
      stateStartedAt: 2_000
    })

    expect(dispatchCompletion).not.toHaveBeenCalled()
    expect(dispatchHookLifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'done', announceCompletion: false })
    )
    first.dispose()

    const remounted = createAgentCompletionCoordinator(options)
    remounted.observeHookStatus({
      state: 'done',
      prompt: 'start background work',
      agentType: 'grok',
      completionOutcome: 'succeeded',
      announceCompletion: true,
      stateStartedAt: 2_000
    })

    expect(dispatchCompletion).not.toHaveBeenCalled()
  })
})
