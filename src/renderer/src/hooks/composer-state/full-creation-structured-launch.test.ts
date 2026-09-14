import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settleStructuredAgentLaunch: vi.fn(),
  activateStructuredAgentSessionById: vi.fn()
}))

vi.mock('@/lib/structured-agent-launch-settlement', () => ({
  settleStructuredAgentLaunch: mocks.settleStructuredAgentLaunch
}))

vi.mock('@/lib/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionById: mocks.activateStructuredAgentSessionById
}))

import {
  adoptAgentSessionLaunchVerdict,
  type AgentSessionLaunchVerdict
} from '@/lib/agent-session-launch-plan'
import { settleFullCreationStructuredLaunch } from './full-creation-structured-launch'

/** Planned before the worktree existed, so the verdict names no workspace. */
const plan = (overrides: Partial<AgentSessionLaunchVerdict> = {}) =>
  adoptAgentSessionLaunchVerdict({
    route: 'structured-native-chat',
    agent: 'codex',
    prompt: 'Fix the route',
    promptDelivery: 'auto-submit',
    ...overrides
  })

const baseArgs = {
  plan: plan(),
  worktreeId: 'worktree-1'
}

describe('settleFullCreationStructuredLaunch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips the loop when the route is not structured', async () => {
    await expect(
      settleFullCreationStructuredLaunch({ ...baseArgs, plan: plan({ route: 'terminal-tui' }) })
    ).resolves.toBeNull()
    expect(mocks.settleStructuredAgentLaunch).not.toHaveBeenCalled()
  })

  it('hands the loop the prompt and activates the structured tab when ready', async () => {
    mocks.settleStructuredAgentLaunch.mockImplementation(
      async (_worktreeId, _agent, _options, hooks) => {
        hooks.onStructuredReady('session-1')
        return { kind: 'structured', sessionId: 'session-1' }
      }
    )

    await expect(
      settleFullCreationStructuredLaunch({ ...baseArgs, plan: plan({ promptDelivery: 'draft' }) })
    ).resolves.toEqual({ kind: 'structured', sessionId: 'session-1' })
    expect(mocks.settleStructuredAgentLaunch).toHaveBeenCalledWith(
      'worktree-1',
      'codex',
      { prompt: 'Fix the route', promptDelivery: 'draft' },
      expect.anything()
    )
    expect(mocks.activateStructuredAgentSessionById).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      sessionId: 'session-1'
    })
  })

  it('does not offer a terminal fallback to the structured launch', async () => {
    mocks.settleStructuredAgentLaunch.mockImplementation(
      async (_worktreeId, _agent, _options, hooks) => {
        expect(hooks).not.toHaveProperty('legacyFallback')
        return { kind: 'failed', error: new Error('unsupported') }
      }
    )

    await expect(settleFullCreationStructuredLaunch(baseArgs)).resolves.toMatchObject({
      kind: 'failed'
    })
  })
})
