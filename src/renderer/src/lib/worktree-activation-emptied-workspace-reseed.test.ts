import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { activateAndRevealFolderWorkspace, activateAndRevealWorktree } from './worktree-activation'
import * as activationGate from './worktree-agent-activation-gate'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { toSshExecutionHostId } from '../../../shared/execution-host'
import {
  makeCreatedAgentWorktree as makeWorktree,
  seedEmptyActivatableWorktree
} from '@/lib/worktree-activation-created-agent-test-state'
import {
  registerWorkspaceSurfaceProducer,
  resetWorkspaceSurfaceProducersForTests
} from './workspace-surface-production'
import { resetWorkspaceActivationRecoveryPresentationsForTests } from './workspace-activation-recovery-presentation'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'

const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetWorkspaceSurfaceProducersForTests()
  resetWorkspaceActivationRecoveryPresentationsForTests()
  useAppStore.setState(initialAppStoreState, true)
})

function seedClosedLastTerminal(worktreeId: string): void {
  useAppStore.setState({ tabsByWorktree: { [worktreeId]: [] } })
  expect(useAppStore.getState().reconcileWorktreeTabModel(worktreeId).renderableTabCount).toBe(0)
}

function sleepingRecord(worktreeId: string): SleepingAgentSessionRecord {
  return {
    paneKey: 'pane-1',
    worktreeId,
    agent: 'codex',
    providerSession: { key: 'session_id', id: 'session-1' },
    prompt: '',
    state: 'done',
    capturedAt: 1,
    updatedAt: 1,
    origin: 'worktree-sleep'
  }
}

describe('selection-free empty-workspace recovery', () => {
  it.each([
    ['Blank Terminal', null],
    ['an agent selection without a producer', 'codex' as const]
  ])('seeds one plain shell for %s when inventory APIs are unavailable', async (_label, agent) => {
    const worktree = makeWorktree()
    seedEmptyActivatableWorktree(worktree)
    seedClosedLastTerminal(worktree.id)

    const result = activateAndRevealWorktree(worktree.id, {
      agent,
      notifyHostRuntime: false
    })

    expect(result).toEqual({ primaryTabId: expect.any(String) })
    expect(useAppStore.getState().tabsByWorktree[worktree.id]).toHaveLength(1)
    expect(result === false ? null : result.primaryTabId).toBe(
      useAppStore.getState().tabsByWorktree[worktree.id]?.[0]?.id
    )
    expect(useAppStore.getState().tabsByWorktree[worktree.id]?.[0]?.launchAgent).toBeUndefined()
  })

  it.each([null, 'codex' as const])(
    're-seeds after a gate reports empty regardless of picker selection (%s)',
    async (agent) => {
      const worktree = makeWorktree()
      seedEmptyActivatableWorktree(worktree)
      seedClosedLastTerminal(worktree.id)
      useAppStore.setState({
        sleepingAgentSessionsByPaneKey: {
          'pane-1': sleepingRecord(worktree.id)
        }
      })
      vi.spyOn(activationGate, 'gateWorktreeAgentActivation').mockResolvedValue('empty')

      activateAndRevealWorktree(worktree.id, { agent, notifyHostRuntime: false })

      await vi.waitFor(() =>
        expect(useAppStore.getState().tabsByWorktree[worktree.id]).toHaveLength(1)
      )
    }
  )

  it('waits for a concrete surface producer instead of a promise boolean', async () => {
    const worktree = makeWorktree()
    seedEmptyActivatableWorktree(worktree)
    const producer = registerWorkspaceSurfaceProducer({
      workspaceKey: worktree.id,
      executionHostId: 'local'
    })

    activateAndRevealWorktree(worktree.id, { agent: 'codex', notifyHostRuntime: false })
    await Promise.resolve()

    expect(useAppStore.getState().tabsByWorktree[worktree.id] ?? []).toHaveLength(0)
    producer.materialized({ kind: 'workspace-content', id: 'requested-content' })
    await producer.attempt.result
    expect(useAppStore.getState().tabsByWorktree[worktree.id] ?? []).toHaveLength(0)
  })

  it('does not double-seed when content appears before the gate settles', async () => {
    const worktree = makeWorktree()
    seedEmptyActivatableWorktree(worktree)
    seedClosedLastTerminal(worktree.id)
    useAppStore.setState({
      sleepingAgentSessionsByPaneKey: { 'pane-1': sleepingRecord(worktree.id) }
    })
    let resolveGate!: (outcome: activationGate.WorktreeAgentActivationOutcome) => void
    vi.spyOn(activationGate, 'gateWorktreeAgentActivation').mockReturnValue(
      new Promise((resolve) => {
        resolveGate = resolve
      })
    )

    activateAndRevealWorktree(worktree.id, { notifyHostRuntime: false })
    useAppStore.getState().createTab(worktree.id)
    resolveGate('empty')

    await vi.waitFor(() =>
      expect(useAppStore.getState().tabsByWorktree[worktree.id]).toHaveLength(1)
    )
  })

  it('keeps a surviving browser as the chosen surface', async () => {
    const worktree = makeWorktree()
    seedEmptyActivatableWorktree(worktree)
    seedClosedLastTerminal(worktree.id)
    useAppStore.getState().createBrowserTab(worktree.id, 'https://example.com', { activate: true })

    activateAndRevealWorktree(worktree.id, { notifyHostRuntime: false })
    await Promise.resolve()

    expect(useAppStore.getState().tabsByWorktree[worktree.id]).toEqual([])
    expect(
      useAppStore.getState().reconcileWorktreeTabModel(worktree.id).activeRenderableTabId
    ).toBeTruthy()
  })
})

const FOLDER_ID = 'folder-1'
const FOLDER_KEY = folderWorkspaceKey(FOLDER_ID)
const SSH_HOST_ID = toSshExecutionHostId('conn-1')

function seedEmptyFolderWorkspace(executionHostId: 'local' | `ssh:${string}`): void {
  useAppStore.setState({
    folderWorkspaces: [
      {
        id: FOLDER_ID,
        projectGroupId: 'group-1',
        name: 'notes',
        folderPath: executionHostId === 'local' ? '/local/notes' : '/remote/notes',
        executionHostId,
        ...(executionHostId === 'local' ? {} : { connectionId: 'conn-1' }),
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
    ],
    activeView: 'terminal',
    tabsByWorktree: { [FOLDER_KEY]: [] },
    unifiedTabsByWorktree: {},
    groupsByWorktree: {},
    getFreshFolderWorkspacePathStatus: () => ({ exists: true, path: '/local/notes' }),
    markWorktreeVisited: vi.fn(),
    recordWorktreeVisit: vi.fn(),
    revealWorktreeInSidebar: vi.fn()
  })
}

describe('folder activation recovery', () => {
  it('recovers the folder-specific activation path without consulting agent selection', async () => {
    seedEmptyFolderWorkspace('local')

    activateAndRevealFolderWorkspace(FOLDER_ID, {
      agent: 'codex',
      executionHostId: 'local'
    })

    await vi.waitFor(() =>
      expect(useAppStore.getState().tabsByWorktree[FOLDER_KEY]).toHaveLength(1)
    )
  })

  it('keeps the direct general setter state-only', async () => {
    seedEmptyFolderWorkspace('local')

    useAppStore.getState().setActiveWorktree(FOLDER_KEY, 'local')
    await Promise.resolve()

    expect(useAppStore.getState().tabsByWorktree[FOLDER_KEY]).toEqual([])
  })

  it('does not start a writer for an unverifiable SSH folder', async () => {
    seedEmptyFolderWorkspace(SSH_HOST_ID)

    activateAndRevealFolderWorkspace(FOLDER_ID, { executionHostId: SSH_HOST_ID })
    await Promise.resolve()

    expect(useAppStore.getState().tabsByWorktree[FOLDER_KEY]).toEqual([])
  })
})
