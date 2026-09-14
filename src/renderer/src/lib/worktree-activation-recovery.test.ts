import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toSshExecutionHostId } from '../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import {
  recoverWorkspaceActivation,
  type WorkspaceActivationIdentity
} from './worktree-activation-recovery'
import {
  readWorkspaceActivationRecoveryPresentation,
  resetWorkspaceActivationRecoveryPresentationsForTests
} from './workspace-activation-recovery-presentation'
import {
  readWorkspaceSurfaceProducerEntries,
  registerWorkspaceSurfaceProducer,
  resetWorkspaceSurfaceProducersForTests
} from './workspace-surface-production'

type FakeUnifiedTab = {
  id: string
  contentType:
    | 'terminal'
    | 'editor'
    | 'diff'
    | 'conflict-review'
    | 'check-details'
    | 'agent-session'
    | 'browser'
    | 'simulator'
}

const mocks = vi.hoisted(() => {
  const storeListeners = new Set<() => void>()
  const structuredListeners = new Set<() => void>()
  let tabSequence = 0
  let uuidSequence = 0
  let reconcileHook: (() => void) | null = null
  let currentState: {
    activeWorktreeId: string
    activeWorkspaceExecutionHostId: string
    executionHostId: string
    runtimeEnvironmentId: string | null
    sleepingAgentSessionsByPaneKey: Record<string, { worktreeId: string }>
    tabsByWorktree: Record<string, unknown[]>
    unifiedTabsByWorktree: Record<string, FakeUnifiedTab[]>
    remoteWorkspaceHydratedTargetIds: Set<string>
    remoteWorkspaceSyncStatusByTargetId: Record<string, { phase: 'offline' | 'synced' }>
    reconcileWorktreeTabModel: (workspaceKey: string) => {
      renderableTabCount: number
      activeRenderableTabId: string | null
    }
    createTab: ReturnType<typeof vi.fn>
  }
  const reconcileWorktreeTabModel = (workspaceKey: string) => {
    const hook = reconcileHook
    reconcileHook = null
    hook?.()
    const tabs = currentState.unifiedTabsByWorktree[workspaceKey] ?? []
    return {
      renderableTabCount: tabs.length,
      activeRenderableTabId: tabs[0]?.id ?? null
    }
  }
  const createTab = vi.fn((workspaceKey: string) => {
    const id = `recovery-tab-${++tabSequence}`
    const tab = { id, contentType: 'terminal' as const }
    currentState.tabsByWorktree[workspaceKey] = [tab]
    currentState.unifiedTabsByWorktree[workspaceKey] = [tab]
    for (const listener of storeListeners) {
      listener()
    }
    return tab
  })
  const freshState = () => ({
    activeWorktreeId: 'worktree-1',
    activeWorkspaceExecutionHostId: 'local',
    executionHostId: 'local',
    runtimeEnvironmentId: null,
    sleepingAgentSessionsByPaneKey: {},
    tabsByWorktree: {},
    unifiedTabsByWorktree: {},
    remoteWorkspaceHydratedTargetIds: new Set<string>(),
    remoteWorkspaceSyncStatusByTargetId: {},
    reconcileWorktreeTabModel,
    createTab
  })
  currentState = freshState()
  return {
    state: () => currentState,
    reset: () => {
      tabSequence = 0
      uuidSequence = 0
      reconcileHook = null
      createTab.mockReset()
      createTab.mockImplementation((workspaceKey: string) => {
        const id = `recovery-tab-${++tabSequence}`
        const tab = { id, contentType: 'terminal' as const }
        currentState.tabsByWorktree[workspaceKey] = [tab]
        currentState.unifiedTabsByWorktree[workspaceKey] = [tab]
        for (const listener of storeListeners) {
          listener()
        }
        return tab
      })
      currentState = freshState()
    },
    notifyStore: () => {
      for (const listener of storeListeners) {
        listener()
      }
    },
    runOnNextReconcile: (hook: () => void) => {
      reconcileHook = hook
    },
    subscribeStore: (listener: () => void) => {
      storeListeners.add(listener)
      return () => storeListeners.delete(listener)
    },
    gate: vi.fn(),
    authority: vi.fn(() => 'none'),
    structuredStatus: vi.fn(() => 'idle'),
    subscribeStructured: (listener: () => void) => {
      structuredListeners.add(listener)
      return () => structuredListeners.delete(listener)
    },
    nextUuid: () => `recovery-attempt-${++uuidSequence}`
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: mocks.state,
    subscribe: mocks.subscribeStore
  }
}))
vi.mock('@/components/terminal/initial-terminal', () => ({
  shouldAutoCreateInitialTerminal: (count: number) => count === 0
}))
vi.mock('./worktree-agent-activation-gate', () => ({
  gateWorktreeAgentActivation: mocks.gate
}))
vi.mock('./workspace-terminal-host-authority', () => ({
  resolveWorkspaceTerminalHostAuthority: mocks.authority
}))
vi.mock('./worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: () => mocks.state().executionHostId,
  getRuntimeEnvironmentIdForWorktree: () => mocks.state().runtimeEnvironmentId
}))
vi.mock('./structured-agent-session-launch-status', () => ({
  getStructuredAgentLaunchStatus: mocks.structuredStatus,
  subscribeStructuredAgentLaunchStatus: mocks.subscribeStructured
}))
vi.mock('./browser-uuid', () => ({ createBrowserUuid: mocks.nextUuid }))

const WORKSPACE_KEY = 'worktree-1'

function identity(
  attemptId: string,
  overrides: Partial<WorkspaceActivationIdentity> = {}
): WorkspaceActivationIdentity {
  return {
    workspaceKey: WORKSPACE_KEY,
    executionHostId: 'local',
    runtimeEnvironmentId: null,
    attemptId,
    ...overrides
  }
}

function forceGate(): void {
  mocks.state().sleepingAgentSessionsByPaneKey = {
    pane: { worktreeId: mocks.state().activeWorktreeId }
  }
}

function showSurface(contentType: FakeUnifiedTab['contentType'], id = 'surface-1'): void {
  mocks.state().unifiedTabsByWorktree[mocks.state().activeWorktreeId] = [{ id, contentType }]
  mocks.notifyStore()
}

beforeEach(() => {
  mocks.reset()
  mocks.gate.mockReset()
  mocks.gate.mockResolvedValue('empty')
  mocks.authority.mockReset()
  mocks.authority.mockReturnValue('none')
  mocks.structuredStatus.mockReset()
  mocks.structuredStatus.mockReturnValue('idle')
  resetWorkspaceSurfaceProducersForTests()
  resetWorkspaceActivationRecoveryPresentationsForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('activation recovery failures', () => {
  it('publishes a blocked error and starts no writer', async () => {
    forceGate()
    mocks.gate.mockResolvedValue('blocked')

    const result = await recoverWorkspaceActivation(identity('blocked-attempt'), {
      mode: 'explicit'
    })

    expect(result).toMatchObject({ kind: 'failed', reason: 'blocked' })
    expect(mocks.state().createTab).not.toHaveBeenCalled()
    expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')?.kind).toBe(
      'blocked'
    )
  })

  it.each(['resume', 'adoption'])(
    'contains an escaped %s rejection as an unexpected error',
    async () => {
      forceGate()
      mocks.gate.mockRejectedValue(new Error('inventory mutation failed'))

      const result = await recoverWorkspaceActivation(identity('rejected-attempt'), {
        mode: 'explicit'
      })

      expect(result).toMatchObject({ kind: 'failed', reason: 'unexpected' })
      expect(mocks.state().createTab).not.toHaveBeenCalled()
      expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')).toMatchObject({
        kind: 'unexpected',
        detail: 'inventory mutation failed'
      })
    }
  )

  it('turns a private seeder throw into an actionable error', async () => {
    mocks.state().createTab.mockImplementationOnce(() => {
      throw new Error('tab commit failed')
    })

    const result = await recoverWorkspaceActivation(identity('seeder-attempt'), {
      mode: 'explicit'
    })

    expect(result).toMatchObject({ kind: 'failed', reason: 'unexpected' })
    expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')).toMatchObject({
      kind: 'unexpected',
      detail: 'tab commit failed'
    })
  })

  it('keeps a failed concrete producer visible without substituting a shell', async () => {
    const producer = registerWorkspaceSurfaceProducer({
      workspaceKey: WORKSPACE_KEY,
      executionHostId: 'local',
      attemptId: 'producer-failure'
    })
    producer.failed('agent executable was not found')

    const result = await recoverWorkspaceActivation(identity('failed-producer-attempt'), {
      mode: 'explicit'
    })

    expect(result).toMatchObject({ kind: 'failed', reason: 'producer-failed' })
    expect(mocks.state().createTab).not.toHaveBeenCalled()
    expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')).toMatchObject({
      kind: 'producer-failed',
      detail: 'agent executable was not found'
    })
  })

  it('does not let a surviving unrelated surface hide a producer failure', async () => {
    showSurface('terminal', 'setup-tab')
    const producer = registerWorkspaceSurfaceProducer({
      workspaceKey: WORKSPACE_KEY,
      executionHostId: 'local',
      attemptId: 'failed-agent-producer'
    })
    producer.failed('The requested agent did not start.')

    const result = await recoverWorkspaceActivation(identity('failed-agent-attempt'), {
      mode: 'explicit'
    })

    expect(result).toMatchObject({ kind: 'failed', reason: 'producer-failed' })
    expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')).toMatchObject({
      kind: 'producer-failed',
      detail: 'The requested agent did not start.'
    })
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it('clears a producer failure when Retry observes the requested surface', async () => {
    const producer = registerWorkspaceSurfaceProducer({
      workspaceKey: WORKSPACE_KEY,
      executionHostId: 'local',
      attemptId: 'retry-producer'
    })
    producer.failed('agent executable was not found')
    await recoverWorkspaceActivation(identity('retry-failure'), { mode: 'explicit' })
    const failure = readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')
    expect(failure?.kind).toBe('producer-failed')

    showSurface('agent-session', 'published-after-retry')
    failure?.retry()

    await vi.waitFor(() =>
      expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')).toBeNull()
    )
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it('retains unverifiable producer ownership after cancellation', async () => {
    const producer = registerWorkspaceSurfaceProducer({
      workspaceKey: WORKSPACE_KEY,
      executionHostId: 'local',
      attemptId: 'unknown-producer'
    })
    producer.unverifiable('dispatch acceptance is unknown')

    const result = await recoverWorkspaceActivation(identity('unknown-attempt'), {
      mode: 'explicit'
    })

    expect(result).toMatchObject({
      kind: 'deferred',
      ownerAttemptId: 'unknown-producer'
    })
    expect(readWorkspaceSurfaceProducerEntries(identity('unused'))).toHaveLength(1)
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it('presents a producer refusal reason without substituting a shell', async () => {
    const producer = registerWorkspaceSurfaceProducer({
      workspaceKey: WORKSPACE_KEY,
      executionHostId: 'local',
      attemptId: 'declined-producer'
    })
    producer.declined('Browser publication was refused by the host.')

    await expect(
      recoverWorkspaceActivation(identity('declined-attempt'), { mode: 'explicit' })
    ).resolves.toMatchObject({ kind: 'failed', reason: 'producer-failed' })
    expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')).toMatchObject({
      kind: 'producer-failed',
      detail: 'Browser publication was refused by the host.'
    })
    expect(mocks.state().createTab).not.toHaveBeenCalled()

    readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')?.retry()
    await vi.waitFor(() =>
      expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')?.kind).toBe(
        'producer-failed'
      )
    )
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it('bounds an inventory assessment and publishes an actionable timeout', async () => {
    vi.useFakeTimers()
    forceGate()
    mocks.gate.mockReturnValue(new Promise(() => undefined))

    const recovery = recoverWorkspaceActivation(identity('deadline-attempt'), {
      mode: 'explicit'
    })
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(recovery).resolves.toMatchObject({ kind: 'failed', reason: 'unexpected' })
    expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')?.kind).toBe(
      'unexpected'
    )
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it.each(['adopted', 'structured', 'resumed'] as const)(
    'requires real publication after a %s gate outcome',
    async (outcome) => {
      vi.useFakeTimers()
      forceGate()
      mocks.gate.mockResolvedValue(outcome)

      const recovery = recoverWorkspaceActivation(identity(`gate-${outcome}`), {
        mode: 'explicit'
      })
      await vi.advanceTimersByTimeAsync(30_000)

      await expect(recovery).resolves.toMatchObject({ kind: 'deferred' })
      expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, 'local')?.kind).toBe(
        'unverifiable'
      )
      expect(mocks.state().createTab).not.toHaveBeenCalled()
    }
  )
})

describe('activation recovery settlement', () => {
  it('uses the live startup tombstone at final settlement', async () => {
    forceGate()
    let settleGate!: (outcome: string) => void
    mocks.gate.mockReturnValue(
      new Promise((resolve) => {
        settleGate = resolve
      })
    )
    const recovery = recoverWorkspaceActivation(identity('startup-tombstone'), {
      mode: 'startup'
    })
    await vi.waitFor(() => expect(mocks.gate).toHaveBeenCalled())
    mocks.state().tabsByWorktree[WORKSPACE_KEY] = []
    mocks.notifyStore()
    settleGate('empty')

    await expect(recovery).resolves.toEqual({ kind: 'intentional-empty' })
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it('lets an explicit reopen override a live tombstone', async () => {
    mocks.state().tabsByWorktree[WORKSPACE_KEY] = []

    await expect(
      recoverWorkspaceActivation(identity('explicit-tombstone'), { mode: 'explicit' })
    ).resolves.toMatchObject({ kind: 'materialized', surface: { type: 'terminal' } })
    expect(mocks.state().createTab).toHaveBeenCalledOnce()
  })

  it.each([
    ['terminal', 'terminal'],
    ['diff', 'editor'],
    ['agent-session', 'agent-session'],
    ['browser', 'browser'],
    ['simulator', 'simulator']
  ] as const)(
    'accepts a surviving %s surface without a fallback',
    async (contentType, visibleType) => {
      showSurface(contentType)

      const result = await recoverWorkspaceActivation(identity(`surface-${contentType}`), {
        mode: 'explicit'
      })

      expect(result).toMatchObject({
        kind: 'materialized',
        surface: { id: 'surface-1', type: visibleType }
      })
      expect(mocks.state().createTab).not.toHaveBeenCalled()
    }
  )

  it('cancels one startup request without consuming a later assessment', async () => {
    forceGate()
    mocks.gate.mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValueOnce('empty')
    const abort = new AbortController()
    const first = recoverWorkspaceActivation(identity('cancelled-startup'), {
      mode: 'startup',
      signal: abort.signal
    })
    await vi.waitFor(() => expect(mocks.gate).toHaveBeenCalledOnce())
    abort.abort()
    await expect(first).resolves.toEqual({ kind: 'stale' })

    await expect(
      recoverWorkspaceActivation(identity('replacement-startup'), { mode: 'startup' })
    ).resolves.toMatchObject({ kind: 'materialized' })
    expect(mocks.state().createTab).toHaveBeenCalledOnce()
  })

  it('invalidates an old request across an away-and-back selection cycle', async () => {
    forceGate()
    let settleGate!: (outcome: string) => void
    const sharedGate = new Promise((resolve) => {
      settleGate = resolve
    })
    mocks.gate.mockReturnValue(sharedGate)
    const first = recoverWorkspaceActivation(identity('before-away-and-back'), {
      mode: 'explicit'
    })
    await vi.waitFor(() => expect(mocks.gate).toHaveBeenCalledOnce())

    mocks.state().activeWorktreeId = 'worktree-2'
    mocks.notifyStore()
    mocks.state().activeWorktreeId = WORKSPACE_KEY
    mocks.notifyStore()
    settleGate('empty')

    await expect(first).resolves.toEqual({ kind: 'stale' })
    expect(mocks.state().createTab).not.toHaveBeenCalled()

    await expect(
      recoverWorkspaceActivation(identity('after-away-and-back'), { mode: 'explicit' })
    ).resolves.toMatchObject({ kind: 'materialized' })
    expect(mocks.state().createTab).toHaveBeenCalledOnce()
  })

  it('rejects a joined gate whose host tuple conflicts', async () => {
    forceGate()
    let settleGate!: (outcome: string) => void
    const sharedGate = new Promise((resolve) => {
      settleGate = resolve
    })
    mocks.gate.mockReturnValue(sharedGate)
    const first = recoverWorkspaceActivation(identity('host-a'), { mode: 'explicit' })
    await vi.waitFor(() => expect(mocks.gate).toHaveBeenCalledOnce())

    const sshHost = toSshExecutionHostId('box')
    mocks.state().executionHostId = sshHost
    mocks.state().activeWorkspaceExecutionHostId = sshHost
    mocks.notifyStore()
    const second = recoverWorkspaceActivation(identity('host-b', { executionHostId: sshHost }), {
      mode: 'explicit'
    })

    await expect(second).resolves.toMatchObject({
      kind: 'deferred',
      reason: expect.stringContaining('another execution host')
    })
    expect(readWorkspaceActivationRecoveryPresentation(WORKSPACE_KEY, sshHost)?.kind).toBe(
      'unverifiable'
    )
    expect(mocks.state().createTab).not.toHaveBeenCalled()
    settleGate('empty')
    await expect(first).resolves.toEqual({ kind: 'stale' })
  })

  it.each([
    ['worktree over SSH', WORKSPACE_KEY],
    ['folder over SSH', folderWorkspaceKey('folder-1')]
  ])('does not start a writer for unverifiable %s', async (_label, workspaceKey) => {
    const sshHost = toSshExecutionHostId('box')
    mocks.state().activeWorktreeId = workspaceKey
    mocks.state().executionHostId = sshHost
    mocks.state().activeWorkspaceExecutionHostId = sshHost
    mocks.notifyStore()

    const result = await recoverWorkspaceActivation(
      identity(`ssh-${workspaceKey}`, { workspaceKey, executionHostId: sshHost }),
      { mode: 'explicit' }
    )

    expect(result).toMatchObject({ kind: 'deferred' })
    expect(readWorkspaceActivationRecoveryPresentation(workspaceKey, sshHost)?.kind).toBe(
      'unverifiable'
    )
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it('does not treat a previously hydrated but offline SSH host as exited', async () => {
    const sshHost = toSshExecutionHostId('box')
    mocks.state().executionHostId = sshHost
    mocks.state().activeWorkspaceExecutionHostId = sshHost
    mocks.state().remoteWorkspaceHydratedTargetIds.add('box')
    mocks.state().remoteWorkspaceSyncStatusByTargetId.box = { phase: 'offline' }
    mocks.notifyStore()

    await expect(
      recoverWorkspaceActivation(identity('ssh-offline', { executionHostId: sshHost }), {
        mode: 'explicit'
      })
    ).resolves.toMatchObject({ kind: 'deferred' })
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it('allows SSH recovery only after a current synced inventory proves emptiness', async () => {
    const sshHost = toSshExecutionHostId('box')
    mocks.state().executionHostId = sshHost
    mocks.state().activeWorkspaceExecutionHostId = sshHost
    mocks.state().remoteWorkspaceHydratedTargetIds.add('box')
    mocks.state().remoteWorkspaceSyncStatusByTargetId.box = { phase: 'synced' }
    mocks.notifyStore()

    await expect(
      recoverWorkspaceActivation(identity('ssh-synced', { executionHostId: sshHost }), {
        mode: 'explicit'
      })
    ).resolves.toMatchObject({ kind: 'materialized', surface: { type: 'terminal' } })
    expect(mocks.state().createTab).toHaveBeenCalledOnce()
  })

  it('keeps a producer-owned tab pending until real publication reaches inventory', async () => {
    vi.useFakeTimers()
    showSurface('terminal', 'setup-tab')
    const producer = registerWorkspaceSurfaceProducer({
      workspaceKey: WORKSPACE_KEY,
      executionHostId: 'local',
      attemptId: 'publication-owner'
    })
    producer.materialized({ kind: 'tab', id: 'not-published' })
    const recovery = recoverWorkspaceActivation(identity('publication-attempt'), {
      mode: 'explicit'
    })
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(recovery).resolves.toMatchObject({
      kind: 'deferred',
      ownerAttemptId: 'publication-owner'
    })
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it('settles a producer only from its exact published surface identity', async () => {
    showSurface('terminal', 'setup-tab')
    const producer = registerWorkspaceSurfaceProducer({
      workspaceKey: WORKSPACE_KEY,
      executionHostId: 'local',
      attemptId: 'exact-publication-owner'
    })
    producer.materialized({ kind: 'tab', id: 'agent-session:session-1' })
    const recovery = recoverWorkspaceActivation(identity('exact-publication-attempt'), {
      mode: 'explicit'
    })
    await Promise.resolve()

    mocks.state().unifiedTabsByWorktree[WORKSPACE_KEY] = [
      { id: 'setup-tab', contentType: 'terminal' },
      { id: 'agent-session:session-1', contentType: 'agent-session' }
    ]
    mocks.notifyStore()

    await expect(recovery).resolves.toEqual({
      kind: 'materialized',
      surface: { id: 'agent-session:session-1', type: 'agent-session' }
    })
    expect(mocks.state().createTab).not.toHaveBeenCalled()
  })

  it('lets a reentrant newer activation own the final seed critical section', async () => {
    let newerRecovery: Promise<unknown> | null = null
    mocks.runOnNextReconcile(() => {
      newerRecovery = recoverWorkspaceActivation(identity('reentrant-newer'), {
        mode: 'explicit'
      })
    })

    await expect(
      recoverWorkspaceActivation(identity('reentrant-older'), { mode: 'explicit' })
    ).resolves.toMatchObject({ kind: 'materialized' })
    await expect(newerRecovery).resolves.toMatchObject({ kind: 'materialized' })
    expect(mocks.state().createTab).toHaveBeenCalledOnce()
  })
})
