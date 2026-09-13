// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'
import type { FullCreationExecutionInput } from './full-creation-execution'
import type { PreparedFullSubmit } from './composer-submit-model'

const mocks = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn(),
  ensureAgentStartupInTerminal: vi.fn(),
  finalizeFullCreation: vi.fn(),
  planAgentSessionLaunch: vi.fn(),
  settleFullCreationStructuredLaunch: vi.fn()
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))

vi.mock('@/lib/new-workspace', () => ({
  ensureAgentStartupInTerminal: mocks.ensureAgentStartupInTerminal
}))

vi.mock('@/lib/agent-session-launch-plan', () => ({
  planAgentSessionLaunch: mocks.planAgentSessionLaunch
}))

vi.mock('./full-creation-structured-launch', () => ({
  settleFullCreationStructuredLaunch: mocks.settleFullCreationStructuredLaunch
}))

vi.mock('./full-creation-finalization', () => ({
  finalizeFullCreation: mocks.finalizeFullCreation
}))

import { useFullCreationExecution } from './full-creation-execution'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('useFullCreationExecution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not create after dismissal while the late startup-policy preflight is pending', async () => {
    const startupPolicy = deferred<boolean>()
    let cancelled = false
    const createWorktree = vi.fn<FullCreationExecutionInput['createWorktree']>()
    const prepared = {
      submitLinkedWorkItem: null,
      submitLinkedIssueNumber: null,
      submitLinkedPR: null,
      submitTitleName: null,
      nameIsAutoManaged: false,
      smartGitHubCreateNames: {
        workspaceName: 'workspace',
        displayName: undefined
      },
      workspaceName: 'workspace',
      nameWasGenerated: false,
      submitBaseBranch: 'main',
      submitCompareBaseRef: undefined,
      submitPushTarget: undefined,
      submitBranchNameOverride: undefined,
      submitLinkedWorkItemProvider: null,
      submitStartupPrompt: '',
      submitShouldRunIssueAutomation: false,
      effectiveSetupDecision: 'skip',
      issueCommandTrustDecision: 'skip',
      confirmedIssueCommandTemplate: '',
      linkedLinearIssue: undefined,
      linkedLinearIssueWorkspaceId: undefined,
      linkedLinearIssueOrganizationUrlKey: undefined,
      effectiveBranchNameOverride: undefined,
      createDisplayName: undefined,
      pendingFirstAgentMessageRename: false,
      startupPlan: null,
      shouldSeedInitialAgentStatus: false,
      composerTelemetry: {
        agent_kind: 'claude-code',
        launch_source: 'new_workspace_composer',
        request_kind: 'new'
      },
      backendStartup: undefined
    } satisfies PreparedFullSubmit
    const persistSetupAgentStartupPolicy = vi.fn(() => startupPolicy.promise)
    const state = {
      applyWorktreeMeta: vi
        .fn<FullCreationExecutionInput['applyWorktreeMeta']>()
        .mockResolvedValue(),
      clearNewWorkspaceDraft: vi.fn<FullCreationExecutionInput['clearNewWorkspaceDraft']>(),
      createWorktree,
      effectivePresetId: null,
      isSubmissionCancelled: () => cancelled,
      linkedGitLabIssue: null,
      linkedGitLabMR: null,
      normalizedSparseDirectories: [],
      note: '',
      onCreated: vi.fn<NonNullable<FullCreationExecutionInput['onCreated']>>(),
      parentWorktreeId: null,
      persistDraft: false,
      persistSetupAgentStartupPolicy,
      prepareFullSubmit: vi
        .fn<FullCreationExecutionInput['prepareFullSubmit']>()
        .mockResolvedValue(prepared),
      resolvedInitialWorkspaceStatus: undefined,
      selectedRepoExecutionHostId: 'local',
      selectedRepoIsGit: true,
      setSidebarOpen: vi.fn<FullCreationExecutionInput['setSidebarOpen']>(),
      sparseEnabled: false,
      taskSourceContext: null,
      telemetrySource: undefined,
      tuiAgent: 'claude'
    } satisfies FullCreationExecutionInput
    const hook = renderHook(() => useFullCreationExecution(state))

    let creation!: Promise<void>
    act(() => {
      creation = hook.result.current.executeFullCreation({ kind: 'none' }, 'repo-1')
    })
    await act(() => Promise.resolve())
    expect(persistSetupAgentStartupPolicy).toHaveBeenCalledTimes(1)

    cancelled = true
    startupPolicy.resolve(true)
    await act(async () => creation)

    expect(createWorktree).not.toHaveBeenCalled()
  })

  it('uses the deadline fallback activation for terminal startup and finalization', async () => {
    const worktree = {
      id: 'worktree-1',
      repoId: 'repo-1',
      path: '/repo/worktree-1',
      head: 'abc123',
      branch: 'feature',
      isBare: false,
      isMainWorktree: false,
      displayName: 'workspace',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 1
    } satisfies Worktree
    const startupPlan = {
      agent: 'codex',
      launchCommand: 'codex',
      expectedProcess: 'codex',
      followupPrompt: null,
      launchConfig: { agentArgs: '', agentEnv: {} }
    } satisfies NonNullable<PreparedFullSubmit['startupPlan']>
    const prepared = {
      submitLinkedWorkItem: null,
      submitLinkedIssueNumber: null,
      submitLinkedPR: null,
      submitTitleName: null,
      nameIsAutoManaged: false,
      smartGitHubCreateNames: { workspaceName: 'workspace', displayName: undefined },
      workspaceName: 'workspace',
      nameWasGenerated: false,
      submitBaseBranch: 'main',
      submitCompareBaseRef: undefined,
      submitPushTarget: undefined,
      submitBranchNameOverride: undefined,
      submitLinkedWorkItemProvider: null,
      submitStartupPrompt: 'Fix it',
      submitShouldRunIssueAutomation: false,
      effectiveSetupDecision: 'skip',
      issueCommandTrustDecision: 'skip',
      confirmedIssueCommandTemplate: '',
      linkedLinearIssue: undefined,
      linkedLinearIssueWorkspaceId: undefined,
      linkedLinearIssueOrganizationUrlKey: undefined,
      effectiveBranchNameOverride: undefined,
      createDisplayName: undefined,
      pendingFirstAgentMessageRename: false,
      startupPlan,
      shouldSeedInitialAgentStatus: false,
      composerTelemetry: {
        agent_kind: 'codex',
        launch_source: 'new_workspace_composer',
        request_kind: 'new'
      },
      backendStartup: undefined
    } satisfies PreparedFullSubmit
    const createWorktree = vi
      .fn<FullCreationExecutionInput['createWorktree']>()
      .mockResolvedValue({ worktree })
    mocks.planAgentSessionLaunch.mockReturnValue({
      route: 'structured-native-chat',
      agent: 'codex'
    })
    mocks.activateAndRevealWorktree.mockReturnValue({ primaryTabId: 'initial-tab' })
    mocks.settleFullCreationStructuredLaunch.mockResolvedValue({
      kind: 'deadline-then-legacy',
      activation: { primaryTabId: 'fallback-tab' },
      primaryTabId: 'fallback-tab'
    })
    const state = {
      applyWorktreeMeta: vi
        .fn<FullCreationExecutionInput['applyWorktreeMeta']>()
        .mockResolvedValue(),
      clearNewWorkspaceDraft: vi.fn<FullCreationExecutionInput['clearNewWorkspaceDraft']>(),
      createWorktree,
      effectivePresetId: null,
      isSubmissionCancelled: () => false,
      linkedGitLabIssue: null,
      linkedGitLabMR: null,
      normalizedSparseDirectories: [],
      note: '',
      onCreated: vi.fn<NonNullable<FullCreationExecutionInput['onCreated']>>(),
      parentWorktreeId: null,
      persistDraft: false,
      persistSetupAgentStartupPolicy: vi.fn().mockResolvedValue(true),
      prepareFullSubmit: vi.fn().mockResolvedValue(prepared),
      resolvedInitialWorkspaceStatus: undefined,
      selectedRepoExecutionHostId: 'local',
      selectedRepoIsGit: true,
      setSidebarOpen: vi.fn<FullCreationExecutionInput['setSidebarOpen']>(),
      sparseEnabled: false,
      taskSourceContext: null,
      telemetrySource: undefined,
      tuiAgent: 'codex'
    } satisfies FullCreationExecutionInput
    const hook = renderHook(() => useFullCreationExecution(state))

    await act(() => hook.result.current.executeFullCreation({ kind: 'none' }, 'repo-1'))

    expect(mocks.ensureAgentStartupInTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ primaryTabId: 'fallback-tab' })
    )
    expect(mocks.finalizeFullCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        activation: { primaryTabId: 'fallback-tab' },
        structuredLaunchAccepted: false
      })
    )
  })
})
