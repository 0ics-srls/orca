import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  structuredAgentSessionLaunchFeasible: vi.fn(),
  getState: vi.fn(() => ({}))
}))

vi.mock('@/lib/agent-session-launch-plan', () => ({
  structuredAgentSessionLaunchFeasible: mocks.structuredAgentSessionLaunchFeasible
}))
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))

import { sourceControlLaunchAppliesAgentArgs } from './source-control-launch-agent-args-applicability'

const CHAT_BY_DEFAULT = {
  experimentalNativeChat: true,
  openAgentTabsInChatByDefault: true,
  experimentalStructuredNativeChat: true
}

describe('sourceControlLaunchAppliesAgentArgs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies arguments when the user launches into a terminal by default', () => {
    expect(
      sourceControlLaunchAppliesAgentArgs({
        agent: 'codex',
        worktreeId: 'wt-1',
        settings: { experimentalNativeChat: false, openAgentTabsInChatByDefault: false }
      })
    ).toBe(true)
    // The route never has to be resolved: the default alone settles it.
    expect(mocks.structuredAgentSessionLaunchFeasible).not.toHaveBeenCalled()
  })

  it('drops arguments only when this launch would really be a structured session', () => {
    mocks.structuredAgentSessionLaunchFeasible.mockReturnValue(true)
    expect(
      sourceControlLaunchAppliesAgentArgs({
        agent: 'codex',
        worktreeId: 'wt-1',
        settings: CHAT_BY_DEFAULT
      })
    ).toBe(false)
  })

  it('keeps arguments for a chat-by-default user whose launch falls back to a terminal', () => {
    // A remote host, an agent without a structured session, or a floating workspace all land here.
    mocks.structuredAgentSessionLaunchFeasible.mockReturnValue(false)
    expect(
      sourceControlLaunchAppliesAgentArgs({
        agent: 'codex',
        worktreeId: 'wt-1',
        settings: CHAT_BY_DEFAULT
      })
    ).toBe(true)
  })

  it('applies arguments while no agent is chosen yet', () => {
    expect(
      sourceControlLaunchAppliesAgentArgs({
        agent: null,
        worktreeId: 'wt-1',
        settings: CHAT_BY_DEFAULT
      })
    ).toBe(true)
    expect(mocks.structuredAgentSessionLaunchFeasible).not.toHaveBeenCalled()
  })

  it('names the repo when the workspace does not exist yet', () => {
    mocks.structuredAgentSessionLaunchFeasible.mockReturnValue(true)
    sourceControlLaunchAppliesAgentArgs({
      agent: 'codex',
      repoId: 'repo-1',
      settings: CHAT_BY_DEFAULT
    })
    expect(mocks.structuredAgentSessionLaunchFeasible).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspace: { kind: 'git-worktree', repoId: 'repo-1' } })
    )
  })
})
