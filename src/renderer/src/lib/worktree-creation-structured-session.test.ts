import { beforeEach, describe, expect, it, vi } from 'vitest'

type PendingCreationState = { pendingWorktreeCreations: Record<string, unknown> }
type PendingCreationListener = (state: PendingCreationState) => void

const mocks = vi.hoisted(() => {
  const pendingWorktreeCreations: Record<string, unknown> = { 'creation-1': {} }
  const noPendingCreationListener = (): PendingCreationListener | null => null
  return {
    state: {
      pendingWorktreeCreations,
      updatePendingWorktreeCreation: vi.fn()
    },
    listener: noPendingCreationListener(),
    unsubscribe: vi.fn(),
    startStructuredAgentLaunch: vi.fn(),
    cancelStructuredAgentLaunch: vi.fn(),
    closeStructuredAgentSession: vi.fn(),
    callRuntimeRpc: vi.fn(),
    activateStructuredAgentSessionById: vi.fn(),
    activateAndRevealWorktree: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(vi.fn(), {
    getState: () => mocks.state,
    subscribe: vi.fn((listener: PendingCreationListener) => {
      mocks.listener = listener
      return mocks.unsubscribe
    })
  })
}))

vi.mock('@/lib/structured-agent-session-launch', () => ({
  startStructuredAgentLaunch: mocks.startStructuredAgentLaunch,
  cancelStructuredAgentLaunch: mocks.cancelStructuredAgentLaunch
}))

vi.mock('@/runtime/structured-agent-session-close', () => ({
  closeStructuredAgentSession: mocks.closeStructuredAgentSession
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc
}))

vi.mock('@/runtime/runtime-worktree-selector', () => ({
  toRuntimeWorktreeSelector: (worktreeId: string) => ({ id: worktreeId })
}))

vi.mock('@/lib/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionById: mocks.activateStructuredAgentSessionById
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))

vi.mock('@/lib/launch-structured-agent-session', () => ({
  StructuredAgentSessionCreateRefusalError: class extends Error {}
}))

import { StructuredAgentSessionCreateRefusalError } from '@/lib/launch-structured-agent-session'
import { launchStructuredWorktreeSession } from './worktree-creation-structured-session'

const request = {
  repoId: 'repo-1',
  name: 'routing-recovery',
  setupDecision: 'run' as const,
  agent: 'codex' as const,
  agentLaunchRoute: 'structured-native-chat' as const,
  pendingFirstAgentMessageRename: true,
  note: '',
  startupPlan: null,
  quickPrompt: 'Fix the route',
  quickTelemetry: null
}

const baseArgs = {
  creationId: 'creation-1',
  request,
  agentLaunchRoute: 'structured-native-chat' as const,
  worktreeId: 'worktree-1',
  shouldActivateOnCompletion: true,
  activation: false as const,
  primaryTabId: null
}

function launchResult(result: Promise<{ sessionId: string; fence: number }>) {
  mocks.startStructuredAgentLaunch.mockReturnValue({
    sessionId: 'session-1',
    launchResult: result,
    isVisibilityUnknown: () => false,
    releaseCallerAfterUnknownOutcome: vi.fn()
  })
}

describe('launchStructuredWorktreeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state = {
      pendingWorktreeCreations: { 'creation-1': {} },
      updatePendingWorktreeCreation: vi.fn()
    }
    mocks.listener = null
    mocks.closeStructuredAgentSession.mockResolvedValue('closed')
    mocks.callRuntimeRpc.mockResolvedValue(undefined)
  })

  it('shows starting chat before beginning the structured launch', async () => {
    launchResult(Promise.resolve({ sessionId: 'session-1', fence: 1 }))
    mocks.activateAndRevealWorktree.mockReturnValue({ primaryTabId: null })

    await expect(launchStructuredWorktreeSession(baseArgs)).resolves.toEqual({
      accepted: true,
      cancelled: false,
      visibilityUnknown: false,
      activation: { primaryTabId: null },
      primaryTabId: null
    })

    expect(mocks.state.updatePendingWorktreeCreation).toHaveBeenCalledWith('creation-1', {
      phase: 'starting-chat'
    })
    expect(mocks.state.updatePendingWorktreeCreation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startStructuredAgentLaunch.mock.invocationCallOrder[0]
    )
    expect(mocks.activateStructuredAgentSessionById).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      sessionId: 'session-1'
    })
  })

  it('keeps a definitive refusal on the structured path', async () => {
    launchResult(Promise.reject(new StructuredAgentSessionCreateRefusalError('unsupported')))

    await expect(launchStructuredWorktreeSession(baseArgs)).resolves.toEqual({
      accepted: true,
      cancelled: false,
      visibilityUnknown: false,
      activation: false,
      primaryTabId: null
    })

    expect(mocks.activateAndRevealWorktree).not.toHaveBeenCalled()
    expect(mocks.activateStructuredAgentSessionById).not.toHaveBeenCalled()
  })

  it('reports unknown visibility without claiming a surface', async () => {
    const releaseCallerAfterUnknownOutcome = vi.fn()
    mocks.startStructuredAgentLaunch.mockReturnValue({
      sessionId: 'session-unknown',
      launchResult: Promise.reject(new Error('connection lost')),
      isVisibilityUnknown: () => true,
      releaseCallerAfterUnknownOutcome
    })

    await expect(launchStructuredWorktreeSession(baseArgs)).resolves.toMatchObject({
      accepted: true,
      cancelled: false,
      visibilityUnknown: true,
      activation: false,
      primaryTabId: null
    })
    expect(releaseCallerAfterUnknownOutcome).toHaveBeenCalledOnce()
  })

  it('retries an unknown launch without staging the prompt again', async () => {
    launchResult(Promise.resolve({ sessionId: 'session-1', fence: 1 }))

    await launchStructuredWorktreeSession({ ...baseArgs, recoverUnknownLaunch: true })

    expect(mocks.startStructuredAgentLaunch).toHaveBeenCalledWith('worktree-1', 'codex', {})
  })

  it('does not activate a published session when creation deferred activation', async () => {
    launchResult(Promise.resolve({ sessionId: 'session-1', fence: 1 }))

    await launchStructuredWorktreeSession({
      ...baseArgs,
      shouldActivateOnCompletion: false,
      primaryTabId: 'existing-tab'
    })

    expect(mocks.activateStructuredAgentSessionById).not.toHaveBeenCalled()
    expect(mocks.activateAndRevealWorktree).not.toHaveBeenCalled()
  })

  it('returns cancelled without launching when the pending creation is already gone', async () => {
    mocks.state.pendingWorktreeCreations = {}

    await expect(launchStructuredWorktreeSession(baseArgs)).resolves.toMatchObject({
      cancelled: true,
      activation: false,
      primaryTabId: null
    })
    expect(mocks.startStructuredAgentLaunch).not.toHaveBeenCalled()
  })

  it('cancels and retires a structured session when the creation is dismissed', async () => {
    const pending = Promise.withResolvers<{ sessionId: string; fence: number }>()
    launchResult(pending.promise)
    const result = launchStructuredWorktreeSession(baseArgs)
    await vi.waitFor(() => expect(mocks.startStructuredAgentLaunch).toHaveBeenCalledOnce())

    mocks.state.pendingWorktreeCreations = {}
    mocks.listener?.(mocks.state)
    pending.resolve({ sessionId: 'session-1', fence: 1 })

    await expect(result).resolves.toMatchObject({ cancelled: true })
    expect(mocks.cancelStructuredAgentLaunch).toHaveBeenCalledWith('worktree-1', 'session-1')
    expect(mocks.closeStructuredAgentSession).toHaveBeenCalledWith({ kind: 'local' }, 'session-1')
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'session.tabs.close', {
      worktree: { id: 'worktree-1' },
      tabId: 'agent-session:session-1',
      reason: 'user'
    })
  })
})
