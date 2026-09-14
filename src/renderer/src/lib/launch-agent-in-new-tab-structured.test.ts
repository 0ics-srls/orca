import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructuredAgentLaunchSettlement } from './structured-agent-launch-settlement'

const mocks = vi.hoisted(() => ({
  settleStructuredAgentLaunch: vi.fn()
}))

vi.mock('@/lib/structured-agent-launch-settlement', () => ({
  settleStructuredAgentLaunch: mocks.settleStructuredAgentLaunch
}))

import { adoptAgentSessionLaunchVerdict } from './agent-session-launch-plan'
import { launchAgentInStructuredNewTab } from './launch-agent-in-new-tab-structured'

type Delivery = 'auto-submit' | 'submit-after-ready' | 'draft'

const structuredPlan = (prompt: string, promptDelivery: Delivery, onPromptDelivered?: () => void) =>
  adoptAgentSessionLaunchVerdict({
    route: 'structured-native-chat',
    agent: 'codex',
    worktreeId: 'wt-1',
    prompt,
    promptDelivery,
    ...(onPromptDelivered ? { onPromptDelivered } : {})
  })

const delivered = { delivered: true, failureNotified: false }
const undelivered = { delivered: false, failureNotified: true }

function settleWith(settlement: StructuredAgentLaunchSettlement) {
  mocks.settleStructuredAgentLaunch.mockResolvedValue(settlement)
}

describe('launchAgentInStructuredNewTab', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('hands the launch to the shared loop with no terminal fallback', async () => {
    const promptDeliveryResult = Promise.resolve(delivered)
    settleWith({ kind: 'structured', sessionId: 'session-1', promptDeliveryResult })
    const onPromptDelivered = vi.fn()

    const result = launchAgentInStructuredNewTab({
      plan: structuredPlan('Fix it', 'submit-after-ready', onPromptDelivered)
    })

    expect(mocks.settleStructuredAgentLaunch).toHaveBeenCalledWith(
      'wt-1',
      'codex',
      { prompt: 'Fix it', promptDelivery: 'submit-after-ready', onPromptDelivered },
      {}
    )
    await expect(result.structuredSettlement).resolves.toEqual({
      kind: 'structured',
      sessionId: 'session-1',
      promptDeliveryResult
    })
    await expect(result.promptDeliveryResult).resolves.toEqual(delivered)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('keeps a failed structured launch failed and reports no delivery', async () => {
    const error = new Error('boom')
    settleWith({ kind: 'failed', error })

    const result = launchAgentInStructuredNewTab({
      plan: structuredPlan('Fix it', 'submit-after-ready')
    })

    await expect(result.structuredSettlement).resolves.toEqual({ kind: 'failed', error })
    await expect(result.promptDeliveryResult).resolves.toEqual(undelivered)
    expect(consoleError).toHaveBeenCalledWith('Structured agent launch failed', error)
  })

  it('treats a thrown settle loop as a failed settlement', async () => {
    const error = new Error('intent unavailable')
    mocks.settleStructuredAgentLaunch.mockRejectedValue(error)

    const result = launchAgentInStructuredNewTab({
      plan: structuredPlan('Fix it', 'submit-after-ready')
    })

    await expect(result.structuredSettlement).resolves.toEqual({ kind: 'failed', error })
    await expect(result.promptDeliveryResult).resolves.toEqual(undelivered)
  })

  it('surfaces an unknown outcome silently', async () => {
    settleWith({ kind: 'visibility-unknown', sessionId: 'session-1' })

    const result = launchAgentInStructuredNewTab({
      plan: structuredPlan('Fix it', 'submit-after-ready')
    })

    await expect(result.structuredSettlement).resolves.toEqual({
      kind: 'visibility-unknown',
      sessionId: 'session-1'
    })
    await expect(result.promptDeliveryResult).resolves.toEqual(undelivered)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it.each([
    ['no prompt', '', 'auto-submit' as const],
    ['a draft prompt', 'Fix it', 'draft' as const]
  ])('exposes no delivery promise for %s', async (_label, prompt, promptDelivery) => {
    settleWith({ kind: 'structured', sessionId: 'session-1' })

    const result = launchAgentInStructuredNewTab({
      plan: structuredPlan(prompt, promptDelivery)
    })

    expect(result.promptDeliveryResult).toBeUndefined()
    await expect(result.structuredSettlement).resolves.toMatchObject({ kind: 'structured' })
  })
})
