import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import { adoptAgentSessionLaunchVerdict } from './agent-session-launch-plan'

const mocks = vi.hoisted(() => ({
  buildDirectWorkItemStartup: vi.fn(),
  getConnectionId: vi.fn(),
  getLocalProjectExecutionRuntimeContext: vi.fn(),
  markDirectWorkItemAgentTrusted: vi.fn(),
  resolveDirectWorkItemAgent: vi.fn()
}))

vi.mock('@/lib/connection-context', () => ({ getConnectionId: mocks.getConnectionId }))
vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'darwin' }))
vi.mock('@/lib/local-preflight-context', () => ({
  getLocalProjectExecutionRuntimeContext: mocks.getLocalProjectExecutionRuntimeContext
}))
vi.mock('@/lib/launch-work-item-direct-agent-routing', () => ({
  buildDirectWorkItemStartup: mocks.buildDirectWorkItemStartup,
  markDirectWorkItemAgentTrusted: mocks.markDirectWorkItemAgentTrusted,
  resolveDirectWorkItemAgent: mocks.resolveDirectWorkItemAgent
}))

import { prepareDirectWorkItemAgentLaunch } from './launch-work-item-direct-route-preparation'

describe('prepareDirectWorkItemAgentLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getConnectionId.mockReturnValue(null)
    mocks.getLocalProjectExecutionRuntimeContext.mockReturnValue(null)
    mocks.resolveDirectWorkItemAgent.mockResolvedValue({ unavailable: false, agent: 'codex' })
    mocks.buildDirectWorkItemStartup.mockReturnValue({
      startupPlan: null,
      draftLaunchedNatively: false,
      startupPlanFailed: false
    })
    mocks.markDirectWorkItemAgentTrusted.mockResolvedValue(undefined)
  })

  it.each(['--model gpt-5.6-sol', '--dangerously-bypass-approvals-and-sandbox'])(
    'passes explicit recipe arguments to the shared route planner: %s',
    async (agentArgs) => {
      const updateWorktreeMeta = vi.fn().mockResolvedValue(undefined)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Mocked collaborators only read updateWorktreeMeta and settings in this focused preparation test.
      const store = { updateWorktreeMeta, settings: {} } as AppState
      const planLaunch = vi.fn().mockReturnValue(
        adoptAgentSessionLaunchVerdict({
          route: 'legacy-native-chat',
          agent: 'codex',
          worktreeId: 'worktree-1',
          prompt: 'Fix the launch',
          promptDelivery: 'submit-after-ready'
        })
      )

      const result = await prepareDirectWorkItemAgentLaunch({
        worktreeId: 'worktree-1',
        worktreePath: '/repo/worktree',
        repoId: 'repo-1',
        agentOverride: 'codex',
        agentArgs,
        repoConnectionId: null,
        detectedAgentsPromise: null,
        latestStore: store,
        settings: store.settings,
        draftContent: 'Fix the launch',
        promptDelivery: 'submit-after-ready',
        planLaunch
      })

      expect(planLaunch).toHaveBeenCalledWith(
        store,
        expect.objectContaining({ tuiCustomization: { agentArgs } })
      )
      expect(result.structuredLaunch).toBe(false)
    }
  )
})
