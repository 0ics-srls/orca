// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type * as NewWorkspaceModule from '@/lib/new-workspace'
import type * as StructuredLaunchSettlementModule from '@/lib/structured-agent-launch-settlement'

const mocks = vi.hoisted(() => ({
  activateAndRevealFolderWorkspace: vi.fn(),
  ensureAgentStartupInTerminal: vi.fn(),
  settleStructuredAgentLaunch:
    vi.fn<typeof StructuredLaunchSettlementModule.settleStructuredAgentLaunch>()
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealFolderWorkspace: mocks.activateAndRevealFolderWorkspace
}))

vi.mock('@/lib/new-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof NewWorkspaceModule>()),
  ensureAgentStartupInTerminal: mocks.ensureAgentStartupInTerminal
}))

vi.mock('@/lib/structured-agent-launch-settlement', async (importOriginal) => ({
  ...(await importOriginal<typeof StructuredLaunchSettlementModule>()),
  settleStructuredAgentLaunch: mocks.settleStructuredAgentLaunch
}))

import { useAppStore } from '@/store'
import { setLocalRuntimeCapabilitiesForTests } from '@/runtime/local-runtime-capabilities'
import { submitFolderWorkspaceCreate } from './folder-workspace-composer-submit'

const projectGroup: ProjectGroup = {
  id: 'group-1',
  name: 'Platform',
  parentPath: '/repo/platform',
  parentGroupId: null,
  createdFrom: 'folder-scan',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

const workspace: FolderWorkspace = {
  id: 'folder-workspace-1',
  projectGroupId: 'group-1',
  name: 'hi',
  folderPath: '/repo/platform/hi',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}

afterEach(() => {
  setLocalRuntimeCapabilitiesForTests(null)
  Reflect.deleteProperty(window, 'api')
  vi.restoreAllMocks()
})

describe('folder workspace structured deadline fallback', () => {
  it('uses the fallback tab for the linked-work-item draft', async () => {
    const previousSettings = useAppStore.getState().settings
    useAppStore.setState({
      settings: {
        ...getDefaultSettings('/tmp/orca-workspaces'),
        experimentalNativeChat: true,
        experimentalStructuredNativeChat: true,
        openAgentTabsInChatByDefault: true
      },
      nativeChatLaunchDraftByTabId: {}
    })
    setLocalRuntimeCapabilitiesForTests([STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY])
    Object.assign(window, {
      api: { agentTrust: { markTrusted: vi.fn().mockResolvedValue(undefined) } }
    })
    mocks.activateAndRevealFolderWorkspace
      .mockReset()
      .mockReturnValueOnce({ primaryTabId: 'initial-tab' })
      .mockReturnValueOnce({ primaryTabId: 'fallback-tab' })
    mocks.settleStructuredAgentLaunch.mockImplementation(
      async (_worktreeId, _agent, _options, hooks) => {
        const fallback = await hooks.legacyFallback?.()
        return fallback
          ? { kind: 'deadline-then-legacy', ...fallback }
          : { kind: 'failed', error: new Error('missing fallback') }
      }
    )
    const issueUrl = 'https://github.com/stablyai/orca/issues/42'

    try {
      await submitFolderWorkspaceCreate({
        projectGroup,
        name: '',
        lastAutoName: '',
        linkedWorkItem: {
          provider: 'github',
          type: 'issue',
          number: 42,
          title: 'Restore linked quick-create',
          url: issueUrl,
          repoId: 'repo-1'
        },
        note: '',
        quickAgent: 'codex',
        autoRenameBranchFromWork: false,
        agentCmdOverrides: {},
        createFolderWorkspace: vi.fn(async () => workspace),
        onOpenChange: vi.fn()
      })

      expect(useAppStore.getState().nativeChatLaunchDraftByTabId['fallback-tab']?.text).toBe(
        issueUrl
      )
      expect(useAppStore.getState().nativeChatLaunchDraftByTabId['initial-tab']).toBeUndefined()
    } finally {
      useAppStore.setState({ settings: previousSettings, nativeChatLaunchDraftByTabId: {} })
    }
  })
})
