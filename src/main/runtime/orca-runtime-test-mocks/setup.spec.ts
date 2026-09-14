import { expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import type * as GitUsernameModule from '../../git/git-username'
import { reviewHeadRemoteRefComponent } from '../../../shared/review-head-tracking-ref'

// Why: durable review-head refs are scoped by remote identity (name + URL hash).
export const ORIGIN_REMOTE_URL = 'git@example.com:group/repo.git'
export const ORIGIN_HEAD_COMPONENT = reviewHeadRemoteRefComponent('origin', ORIGIN_REMOTE_URL)
import type { OrcaRuntimeService as OrcaRuntimeServiceConstructor } from '../orca-runtime'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { setWorktreeWatcherRemoval } from '../../ipc/worktree-watcher-removal'

export const ORIGINAL_PLATFORM = process.platform
export const ORIGINAL_PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform')
const removeWorktreeLinkedPathsMock: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn())
const findExistingWorktreeSymlinkPathsMock: Mock = vi.hoisted(() => vi.fn())
const resolveLocalGitUsernameMock: Mock = vi.hoisted(() => vi.fn(async () => ''))

vi.mock('../../ipc/worktree-symlinks', () => ({
  createWorktreeCopiedPaths: vi.fn(),
  createWorktreeLinkedPaths: vi.fn(),
  createWorktreeSharedPaths: vi.fn(),
  findExistingWorktreeSymlinkPaths: findExistingWorktreeSymlinkPathsMock,
  removeWorktreeLinkedPaths: removeWorktreeLinkedPathsMock
}))

export async function waitForMobileSessionTabsEvents(
  events: RuntimeMobileSessionTabsResult[],
  count: number
): Promise<void> {
  await vi.waitFor(() => expect(events).toHaveLength(count))
}

export function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

export function resetPlatform(): void {
  if (ORIGINAL_PLATFORM_DESCRIPTOR) {
    Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM_DESCRIPTOR)
  }
}

export function acknowledgeAgentPromptSubmit(
  runtime: InstanceType<typeof OrcaRuntimeServiceConstructor>,
  ptyId: string,
  data: string
): void {
  if (data === '\r') {
    runtime.onPtyData(ptyId, '\x1b]0;Codex working\x07', Date.now())
  }
}

const electronMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const listeners = new Map<string, Set<Listener>>()
  const ipcMain = {
    on: vi.fn((channel: string, listener: Listener) => {
      const existing = listeners.get(channel) ?? new Set<Listener>()
      existing.add(listener)
      listeners.set(channel, existing)
      return ipcMain
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.get(channel)?.delete(listener)
      return ipcMain
    }),
    emit: vi.fn((channel: string, ...args: unknown[]) => {
      for (const listener of listeners.get(channel) ?? []) {
        listener(...args)
      }
      return true
    })
  }
  return {
    BrowserWindow: { fromId: vi.fn((_id: number): unknown => null) },
    webContents: { fromId: vi.fn((_id: number): unknown => null) },
    ipcMain,
    app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
  }
})

const closeLocalWatcherForWorktreePathMock: Mock = vi.hoisted(() => vi.fn())
const closeRemoteWatcherForWorktreePathMock: Mock = vi.hoisted(() => vi.fn())
const restoreLocalWatcherAfterFailedRemovalMock: Mock = vi.hoisted(() => vi.fn())
const restoreRemoteWatcherAfterFailedRemovalMock: Mock = vi.hoisted(() => vi.fn())
const forgetLocalWatcherRemovalSnapshotMock: Mock = vi.hoisted(() => vi.fn())
const forgetRemoteWatcherRemovalSnapshotMock: Mock = vi.hoisted(() => vi.fn())
const scanLocalRepoWorktreesForResolutionMock: Mock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => electronMocks)
// Why install the port instead of mocking ../ipc/filesystem-watcher: the runtime calls
// WorktreeWatcherRemoval now, so a module mock would be inert and every assertion below
// would silently pass against the inert default. Same mocks, same expectations.
setWorktreeWatcherRemoval({
  closeLocal: closeLocalWatcherForWorktreePathMock,
  closeRemote: closeRemoteWatcherForWorktreePathMock,
  restoreLocal: restoreLocalWatcherAfterFailedRemovalMock,
  restoreRemote: restoreRemoteWatcherAfterFailedRemovalMock,
  forgetLocal: forgetLocalWatcherRemovalSnapshotMock,
  forgetRemote: forgetRemoteWatcherRemovalSnapshotMock
})

const {
  MOCK_GIT_WORKTREES,
  addSparseWorktreeMock,
  addWorktreeMock,
  removeWorktreeMock,
  forceDeleteLocalBranchMock,
  computeWorktreePathMock,
  ensurePathWithinWorkspaceMock,
  sshGitProviders,
  sshProviderGenerations,
  getSshGitProviderMock,
  getSshGitProviderGenerationMock,
  registerSshGitProviderMock,
  unregisterSshGitProviderMock,
  getActiveMultiplexerMock,
  muxRequestMock,
  invalidateAuthorizedRootsCacheMock,
  prepareLocalWorktreeRootForRepoMock,
  createHostedReviewMock,
  createStackedHostedReviewMock,
  getHostedReviewCreationEligibilityMock,
  getHostedReviewForBranchMock,
  getPRForBranchMock,
  getPRForBranchOutcomeMock,
  getRepoSlugMock,
  getRepoUpstreamMock,
  getGitHubWorkItemMock,
  getPullRequestPushTargetMock,
  getGitHubWorkItemByOwnerRepoMock,
  getGitHubWorkItemDetailsMock,
  getGitHubPRFileContentsMock,
  getGitHubPRChecksMock,
  rerunGitHubPRChecksMock,
  getGitHubPRCheckDetailsMock,
  getGitHubPRCommentsMock,
  resolveGitHubReviewThreadMock,
  setGitHubPRFileViewedMock,
  updateGitHubPRTitleMock,
  updateGitHubPRDetailsMock,
  mergeGitHubPRMock,
  setGitHubPRAutoMergeMock,
  updateGitHubPRStateMock,
  requestGitHubPRReviewersMock,
  removeGitHubPRReviewersMock,
  addGitHubPRReviewCommentMock,
  addGitHubPRReviewCommentReplyMock,
  listGitHubIssuesMock,
  listGitHubWorkItemsMock,
  countGitHubWorkItemsMock,
  createGitHubIssueMock,
  updateGitHubIssueMock,
  addGitHubIssueCommentMock,
  listGitHubLabelsMock,
  listGitHubAssignableUsersMock,
  applyAgentStatusHooksEnabledMock,
  detectInstalledAgentsWithShellPathHydrationMock,
  detectRemoteAgentsMock,
  markCodexProjectTrustedMock,
  markCopilotFolderTrustedMock,
  markCursorWorkspaceTrustedMock,
  listGitLabMergeRequestsMock,
  listGitLabWorkItemsMock,
  listGitLabIssuesMock,
  listGitLabLabelsMock,
  listGitLabTodosMock,
  getGitLabProjectRefForRemoteMock,
  getGitLabWorkItemByProjectRefMock,
  createGitLabIssueMock,
  updateGitLabIssueMock,
  addGitLabIssueCommentMock,
  addGitLabMRCommentMock,
  addGitLabMRInlineCommentMock,
  resolveGitLabMRDiscussionMock,
  getGitLabJobTraceMock,
  retryGitLabJobMock,
  mergeGitLabMRMock,
  closeGitLabMRMock,
  reopenGitLabMRMock,
  updateGitLabMRMock,
  getGlabKnownHostsMock,
  getGitLabWorkItemDetailsMock,
  updateGitLabMRReviewersMock,
  getIssueMock,
  deleteWorktreeHistoryDirMock
} = vi.hoisted(() => {
  // Why: SSH runtime tests register providers via the public dispatcher API, so the mock needs the same registry semantics as the real module.
  const sshGitProviders = new Map<string, unknown>()
  const sshProviderGenerations = new Map<string, number>()

  return {
    MOCK_GIT_WORKTREES: [
      {
        path: '/tmp/worktree-a',
        head: 'abc',
        branch: 'feature/foo',
        isBare: false,
        isMainWorktree: false
      }
    ],
    addSparseWorktreeMock: vi.fn() as Mock,
    addWorktreeMock: vi.fn() as Mock,
    removeWorktreeMock: vi.fn() as Mock,
    forceDeleteLocalBranchMock: vi.fn() as Mock,
    computeWorktreePathMock: vi.fn() as Mock,
    ensurePathWithinWorkspaceMock: vi.fn() as Mock,
    sshGitProviders,
    sshProviderGenerations,
    getSshGitProviderMock: vi.fn((connectionId: string) => sshGitProviders.get(connectionId)),
    getSshGitProviderGenerationMock: vi.fn(
      (connectionId: string) => sshProviderGenerations.get(connectionId) ?? 0
    ),
    registerSshGitProviderMock: vi.fn((connectionId: string, provider: unknown) => {
      sshGitProviders.set(connectionId, provider)
      sshProviderGenerations.set(connectionId, (sshProviderGenerations.get(connectionId) ?? 0) + 1)
    }),
    unregisterSshGitProviderMock: vi.fn((connectionId: string) => {
      if (sshGitProviders.delete(connectionId)) {
        sshProviderGenerations.set(
          connectionId,
          (sshProviderGenerations.get(connectionId) ?? 0) + 1
        )
      }
    }),
    getActiveMultiplexerMock: vi.fn() as Mock,
    muxRequestMock: vi.fn() as Mock,
    invalidateAuthorizedRootsCacheMock: vi.fn() as Mock,
    prepareLocalWorktreeRootForRepoMock: vi.fn() as Mock,
    createHostedReviewMock: vi.fn() as Mock,
    createStackedHostedReviewMock: vi.fn() as Mock,
    getHostedReviewCreationEligibilityMock: vi.fn() as Mock,
    getHostedReviewForBranchMock: vi.fn() as Mock,
    getPRForBranchMock: vi.fn().mockResolvedValue(null) as Mock,
    getPRForBranchOutcomeMock: vi.fn().mockResolvedValue({ kind: 'no-pr', fetchedAt: 0 }) as Mock,
    getRepoSlugMock: vi.fn().mockResolvedValue(null) as Mock,
    getRepoUpstreamMock: vi.fn().mockResolvedValue(null) as Mock,
    getGitHubWorkItemMock: vi.fn() as Mock,
    getPullRequestPushTargetMock: vi.fn() as Mock,
    getGitHubWorkItemByOwnerRepoMock: vi.fn() as Mock,
    getGitHubWorkItemDetailsMock: vi.fn() as Mock,
    getGitHubPRFileContentsMock: vi.fn() as Mock,
    getGitHubPRChecksMock: vi.fn() as Mock,
    rerunGitHubPRChecksMock: vi.fn() as Mock,
    getGitHubPRCheckDetailsMock: vi.fn() as Mock,
    getGitHubPRCommentsMock: vi.fn() as Mock,
    resolveGitHubReviewThreadMock: vi.fn() as Mock,
    setGitHubPRFileViewedMock: vi.fn() as Mock,
    updateGitHubPRTitleMock: vi.fn() as Mock,
    updateGitHubPRDetailsMock: vi.fn() as Mock,
    mergeGitHubPRMock: vi.fn() as Mock,
    setGitHubPRAutoMergeMock: vi.fn() as Mock,
    updateGitHubPRStateMock: vi.fn() as Mock,
    requestGitHubPRReviewersMock: vi.fn() as Mock,
    removeGitHubPRReviewersMock: vi.fn() as Mock,
    addGitHubPRReviewCommentMock: vi.fn() as Mock,
    addGitHubPRReviewCommentReplyMock: vi.fn() as Mock,
    listGitHubIssuesMock: vi.fn() as Mock,
    listGitHubWorkItemsMock: vi.fn() as Mock,
    countGitHubWorkItemsMock: vi.fn() as Mock,
    createGitHubIssueMock: vi.fn() as Mock,
    updateGitHubIssueMock: vi.fn() as Mock,
    addGitHubIssueCommentMock: vi.fn() as Mock,
    listGitHubLabelsMock: vi.fn() as Mock,
    listGitHubAssignableUsersMock: vi.fn() as Mock,
    applyAgentStatusHooksEnabledMock: vi.fn() as Mock,
    detectInstalledAgentsWithShellPathHydrationMock: vi.fn() as Mock,
    detectRemoteAgentsMock: vi.fn() as Mock,
    markCodexProjectTrustedMock: vi.fn() as Mock,
    markCopilotFolderTrustedMock: vi.fn() as Mock,
    markCursorWorkspaceTrustedMock: vi.fn() as Mock,
    listGitLabMergeRequestsMock: vi.fn() as Mock,
    listGitLabWorkItemsMock: vi.fn() as Mock,
    listGitLabIssuesMock: vi.fn() as Mock,
    listGitLabLabelsMock: vi.fn() as Mock,
    listGitLabTodosMock: vi.fn() as Mock,
    getGitLabProjectRefForRemoteMock: vi.fn() as Mock,
    getGitLabWorkItemByProjectRefMock: vi.fn() as Mock,
    createGitLabIssueMock: vi.fn() as Mock,
    updateGitLabIssueMock: vi.fn() as Mock,
    addGitLabIssueCommentMock: vi.fn() as Mock,
    addGitLabMRCommentMock: vi.fn() as Mock,
    addGitLabMRInlineCommentMock: vi.fn() as Mock,
    resolveGitLabMRDiscussionMock: vi.fn() as Mock,
    getGitLabJobTraceMock: vi.fn() as Mock,
    retryGitLabJobMock: vi.fn() as Mock,
    mergeGitLabMRMock: vi.fn() as Mock,
    closeGitLabMRMock: vi.fn() as Mock,
    reopenGitLabMRMock: vi.fn() as Mock,
    updateGitLabMRMock: vi.fn() as Mock,
    getGlabKnownHostsMock: vi.fn() as Mock,
    getGitLabWorkItemDetailsMock: vi.fn() as Mock,
    updateGitLabMRReviewersMock: vi.fn() as Mock,
    getIssueMock: vi.fn() as Mock,
    deleteWorktreeHistoryDirMock: vi.fn() as Mock
  }
})

vi.mock('../../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue(MOCK_GIT_WORKTREES),
  listWorktreesSharedStrict: vi.fn().mockResolvedValue(MOCK_GIT_WORKTREES),
  listWorktreesStrict: vi.fn().mockResolvedValue(MOCK_GIT_WORKTREES),
  describeCreatedWorktree: vi.fn().mockResolvedValue(undefined),
  assertWorktreeCleanForRemoval: vi.fn().mockResolvedValue(undefined),
  addSparseWorktree: addSparseWorktreeMock,
  addWorktree: addWorktreeMock,
  removeWorktree: removeWorktreeMock,
  forceDeleteLocalBranch: forceDeleteLocalBranchMock
}))

vi.mock('../repo-worktree-resolution-scan', () => ({
  scanLocalRepoWorktreesForResolution: scanLocalRepoWorktreesForResolutionMock
}))

vi.mock('../../terminal-history-deletion', () => ({
  deleteWorktreeHistoryDir: deleteWorktreeHistoryDirMock
}))

vi.mock('../../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock,
  getSshGitProviderGeneration: getSshGitProviderGenerationMock,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE:
    'Remote connection dropped. Click Reconnect on the SSH target before retrying.',
  requireSshGitProvider: (connectionId: string) => {
    const provider = getSshGitProviderMock(connectionId)
    if (!provider) {
      throw new Error(
        'Remote connection dropped. Click Reconnect on the SSH target before retrying.'
      )
    }
    return provider
  },
  registerSshGitProvider: registerSshGitProviderMock,
  unregisterSshGitProvider: unregisterSshGitProviderMock
}))

vi.mock('../../ssh/ssh-target-registry', () => ({
  getActiveMultiplexer: getActiveMultiplexerMock,
  getRegisteredSshState: () => ({ remotePlatform: 'linux' }),
  setSshActiveMultiplexerResolver: vi.fn()
}))

vi.mock('../../preflight/agent-detection', () => ({
  detectInstalledAgentsWithShellPathHydration: detectInstalledAgentsWithShellPathHydrationMock,
  detectRemoteAgents: detectRemoteAgentsMock
}))

vi.mock('../../agent-hooks/managed-agent-hook-controls', () => ({
  applyAgentStatusHooksEnabled: applyAgentStatusHooksEnabledMock
}))

vi.mock('../../agent-trust-presets', () => ({
  markCodexProjectTrusted: markCodexProjectTrustedMock,
  markCopilotFolderTrusted: markCopilotFolderTrustedMock,
  markCursorWorkspaceTrusted: markCursorWorkspaceTrustedMock
}))

vi.mock('../../hooks', () => ({
  getEffectiveHooks: vi.fn().mockReturnValue(null),
  loadHooks: vi.fn().mockReturnValue(null),
  runHook: vi.fn().mockResolvedValue({ success: true, output: '' }),
  hasHooksFile: vi.fn().mockReturnValue(false),
  parseOrcaYaml: vi.fn().mockReturnValue(null)
}))

vi.mock('../../setup-runner-script-text', () => ({
  buildPosixRunnerScript: (script: string) => `#!/usr/bin/env bash\nset -e\n${script}\n`,
  buildWindowsRunnerScript: (script: string) => `@echo off\r\n${script}\r\n`
}))

vi.mock('../../worktree-runner-script', () => ({
  createSetupRunnerScript: vi.fn(),
  resolveSetupRunnerShell: vi.fn().mockReturnValue(undefined)
}))

vi.mock('../../setup-hook-env-vars', () => ({
  getSetupRunnerEnvVars: (_repo: never, worktreePath: string) => ({
    ORCA_ROOT_PATH: '/remote/repo',
    ORCA_WORKTREE_PATH: worktreePath
  })
}))

vi.mock('../../effective-hook-config', () => ({
  getEffectiveHooksFromConfig: vi.fn().mockReturnValue(null),
  getDefaultTabCommandTrustContent: vi.fn(
    (hooks: { scripts?: { setup?: string } } | null) => hooks?.scripts?.setup?.trim() ?? ''
  ),
  getDefaultTabsLaunch: vi.fn().mockReturnValue(undefined),
  shouldRunSetupForCreate: vi
    .fn()
    .mockImplementation((_repo: never, decision: string) => decision === 'run'),
  getEffectiveSetupRunPolicy: vi.fn().mockReturnValue('auto')
}))

vi.mock('../../ipc/worktree-logic', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    computeWorktreePath: computeWorktreePathMock,
    ensurePathWithinWorkspace: ensurePathWithinWorkspaceMock
  }
})

vi.mock('../../ipc/filesystem-auth', () => ({
  resolveAuthorizedPath: vi.fn(async (pathValue: string) => pathValue),
  invalidateAuthorizedRootsCache: invalidateAuthorizedRootsCacheMock,
  isENOENT: (error: unknown) =>
    Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}))

vi.mock('../../ipc/registered-worktree-roots-cache', () => ({
  invalidateAuthorizedRootsCache: invalidateAuthorizedRootsCacheMock
}))

vi.mock('../../ipc/filesystem-path-containment', () => ({
  isENOENT: (error: unknown) =>
    Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}))

vi.mock('../../worktree-root-preparation', () => ({
  prepareLocalWorktreeRootForRepo: prepareLocalWorktreeRootForRepoMock
}))

vi.mock('../../source-control/hosted-review-creation', () => ({
  createHostedReview: createHostedReviewMock,
  getHostedReviewCreationEligibility: getHostedReviewCreationEligibilityMock
}))

vi.mock('../../source-control/stacked-hosted-review-creation', () => ({
  createStackedHostedReview: createStackedHostedReviewMock
}))

vi.mock('../../source-control/hosted-review', () => ({
  getHostedReviewForBranch: getHostedReviewForBranchMock
}))

vi.mock('../../github/client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getPRForBranch: getPRForBranchMock,
    getPRForBranchOutcome: getPRForBranchOutcomeMock,
    getRepoSlug: getRepoSlugMock,
    getRepoUpstream: getRepoUpstreamMock,
    getWorkItem: getGitHubWorkItemMock,
    getPullRequestPushTarget: getPullRequestPushTargetMock,
    getWorkItemByOwnerRepo: getGitHubWorkItemByOwnerRepoMock,
    getPRChecks: getGitHubPRChecksMock,
    rerunPRChecks: rerunGitHubPRChecksMock,
    getPRCheckDetails: getGitHubPRCheckDetailsMock,
    getPRComments: getGitHubPRCommentsMock,
    resolveReviewThread: resolveGitHubReviewThreadMock,
    setPRFileViewed: setGitHubPRFileViewedMock,
    updatePRTitle: updateGitHubPRTitleMock,
    updatePRDetails: updateGitHubPRDetailsMock,
    mergePR: mergeGitHubPRMock,
    setPRAutoMerge: setGitHubPRAutoMergeMock,
    updatePRState: updateGitHubPRStateMock,
    requestPRReviewers: requestGitHubPRReviewersMock,
    removePRReviewers: removeGitHubPRReviewersMock,
    addPRReviewComment: addGitHubPRReviewCommentMock,
    addPRReviewCommentReply: addGitHubPRReviewCommentReplyMock,
    listIssues: listGitHubIssuesMock,
    listWorkItems: listGitHubWorkItemsMock,
    countWorkItems: countGitHubWorkItemsMock,
    getIssue: getIssueMock,
    createIssue: createGitHubIssueMock,
    updateIssue: updateGitHubIssueMock,
    addIssueComment: addGitHubIssueCommentMock,
    listLabels: listGitHubLabelsMock,
    listAssignableUsers: listGitHubAssignableUsersMock
  }
})

vi.mock('../../gitlab/client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    listMergeRequests: listGitLabMergeRequestsMock,
    listWorkItems: listGitLabWorkItemsMock,
    listIssues: listGitLabIssuesMock,
    listLabels: listGitLabLabelsMock,
    listTodos: listGitLabTodosMock,
    getProjectRefForRemote: getGitLabProjectRefForRemoteMock,
    getWorkItemByProjectRef: getGitLabWorkItemByProjectRefMock,
    createIssue: createGitLabIssueMock,
    updateIssue: updateGitLabIssueMock,
    addIssueComment: addGitLabIssueCommentMock,
    addMRComment: addGitLabMRCommentMock,
    addMRInlineComment: addGitLabMRInlineCommentMock,
    resolveMRDiscussion: resolveGitLabMRDiscussionMock,
    getJobTrace: getGitLabJobTraceMock,
    retryJob: retryGitLabJobMock,
    mergeMR: mergeGitLabMRMock,
    closeMR: closeGitLabMRMock,
    reopenMR: reopenGitLabMRMock,
    updateMR: updateGitLabMRMock,
    updateMRReviewers: updateGitLabMRReviewersMock
  }
})

vi.mock('../../gitlab/gl-utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getGlabKnownHosts: getGlabKnownHostsMock
  }
})

vi.mock('../../gitlab/work-item-details', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getWorkItemDetails: getGitLabWorkItemDetailsMock
  }
})

vi.mock('../../github/work-item-details', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getWorkItemDetails: getGitHubWorkItemDetailsMock,
    getPRFileContents: getGitHubPRFileContentsMock
  }
})

vi.mock('../../github/issues', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getIssue: getIssueMock
  }
})

// Why: CLI worktree creation resolves a default against fabricated repo paths, so keep the async resolver deterministic.
vi.mock('../../git/repo', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const actualGetBaseRefDefault = actual.getBaseRefDefault as (
    path: string,
    options?: { wslDistro?: string }
  ) => Promise<string | null>
  return {
    ...actual,
    // Why: fabricated local test repos need a deterministic default, while WSL coverage must still exercise the real async Git-options path.
    getBaseRefDefault: vi
      .fn()
      .mockImplementation((path: string, options?: { wslDistro?: string }) =>
        options?.wslDistro ? actualGetBaseRefDefault(path, options) : Promise.resolve('origin/main')
      ),
    getBranchConflictKind: vi.fn().mockResolvedValue(null)
  }
})

vi.mock('../../git/git-username', async () => {
  const actual = await vi.importActual<typeof GitUsernameModule>('../../git/git-username')
  return { ...actual, resolveLocalGitUsername: resolveLocalGitUsernameMock }
})

export {
  electronMocks,
  removeWorktreeLinkedPathsMock,
  findExistingWorktreeSymlinkPathsMock,
  resolveLocalGitUsernameMock,
  closeLocalWatcherForWorktreePathMock,
  closeRemoteWatcherForWorktreePathMock,
  restoreLocalWatcherAfterFailedRemovalMock,
  restoreRemoteWatcherAfterFailedRemovalMock,
  forgetLocalWatcherRemovalSnapshotMock,
  forgetRemoteWatcherRemovalSnapshotMock,
  scanLocalRepoWorktreesForResolutionMock,
  MOCK_GIT_WORKTREES,
  addSparseWorktreeMock,
  addWorktreeMock,
  removeWorktreeMock,
  forceDeleteLocalBranchMock,
  computeWorktreePathMock,
  ensurePathWithinWorkspaceMock,
  sshGitProviders,
  sshProviderGenerations,
  getSshGitProviderMock,
  getSshGitProviderGenerationMock,
  registerSshGitProviderMock,
  unregisterSshGitProviderMock,
  getActiveMultiplexerMock,
  muxRequestMock,
  invalidateAuthorizedRootsCacheMock,
  prepareLocalWorktreeRootForRepoMock,
  createHostedReviewMock,
  createStackedHostedReviewMock,
  getHostedReviewCreationEligibilityMock,
  getHostedReviewForBranchMock,
  getPRForBranchMock,
  getPRForBranchOutcomeMock,
  getRepoSlugMock,
  getRepoUpstreamMock,
  getGitHubWorkItemMock,
  getPullRequestPushTargetMock,
  getGitHubWorkItemByOwnerRepoMock,
  getGitHubWorkItemDetailsMock,
  getGitHubPRFileContentsMock,
  getGitHubPRChecksMock,
  rerunGitHubPRChecksMock,
  getGitHubPRCheckDetailsMock,
  getGitHubPRCommentsMock,
  resolveGitHubReviewThreadMock,
  setGitHubPRFileViewedMock,
  updateGitHubPRTitleMock,
  updateGitHubPRDetailsMock,
  mergeGitHubPRMock,
  setGitHubPRAutoMergeMock,
  updateGitHubPRStateMock,
  requestGitHubPRReviewersMock,
  removeGitHubPRReviewersMock,
  addGitHubPRReviewCommentMock,
  addGitHubPRReviewCommentReplyMock,
  listGitHubIssuesMock,
  listGitHubWorkItemsMock,
  countGitHubWorkItemsMock,
  createGitHubIssueMock,
  updateGitHubIssueMock,
  addGitHubIssueCommentMock,
  listGitHubLabelsMock,
  listGitHubAssignableUsersMock,
  applyAgentStatusHooksEnabledMock,
  detectInstalledAgentsWithShellPathHydrationMock,
  detectRemoteAgentsMock,
  markCodexProjectTrustedMock,
  markCopilotFolderTrustedMock,
  markCursorWorkspaceTrustedMock,
  listGitLabMergeRequestsMock,
  listGitLabWorkItemsMock,
  listGitLabIssuesMock,
  listGitLabLabelsMock,
  listGitLabTodosMock,
  getGitLabProjectRefForRemoteMock,
  getGitLabWorkItemByProjectRefMock,
  createGitLabIssueMock,
  updateGitLabIssueMock,
  addGitLabIssueCommentMock,
  addGitLabMRCommentMock,
  addGitLabMRInlineCommentMock,
  resolveGitLabMRDiscussionMock,
  getGitLabJobTraceMock,
  retryGitLabJobMock,
  mergeGitLabMRMock,
  closeGitLabMRMock,
  reopenGitLabMRMock,
  updateGitLabMRMock,
  getGlabKnownHostsMock,
  getGitLabWorkItemDetailsMock,
  updateGitLabMRReviewersMock,
  getIssueMock,
  deleteWorktreeHistoryDirMock
}
