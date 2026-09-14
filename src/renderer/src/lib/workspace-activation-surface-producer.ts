import { useAppStore } from '@/store'
import { resolveWorkspaceExecutionEvidence } from './workspace-execution-evidence'
import {
  canInspectAgentActivationInventory,
  hasLiveActivationTerminalTombstone,
  isActivationExecutionRouteCurrent,
  readActivationRenderableSurface,
  WORKSPACE_ACTIVATION_RECOVERY_DEADLINE_MS
} from './workspace-activation-recovery-state'
import {
  discardWorkspaceSurfaceProducerAttempt,
  readWorkspaceSurfaceProducerEntries,
  registerWorkspaceSurfaceProducer,
  type WorkspaceSurfaceProducer
} from './workspace-surface-production'
import { ensureWorktreeHasInitialTerminal } from './worktree-initial-terminal-seeding'
import { gateWorktreeAgentActivation } from './worktree-agent-activation-gate'
import { workspaceHasSleepingAgentSessions } from './worktree-agent-activation-claims'
import type { WorktreeAgentActivationRoute } from './worktree-agent-activation-route'
import type { WorkspaceActivationIdentity } from './worktree-activation-recovery'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'

type ActivationSurfaceProductionContext = { mode: 'explicit' | 'startup' }

function settleProducedSurface(
  producer: WorkspaceSurfaceProducer,
  identity: WorkspaceActivationIdentity & WorktreeAgentActivationRoute,
  context: ActivationSurfaceProductionContext,
  maySeedEmptySurface: boolean
): string | null {
  if (!isActivationExecutionRouteCurrent(identity)) {
    discardWorkspaceSurfaceProducerAttempt(producer.attempt.id)
    return null
  }
  const visible = readActivationRenderableSurface(identity)
  if (!isActivationExecutionRouteCurrent(identity)) {
    discardWorkspaceSurfaceProducerAttempt(producer.attempt.id)
    return null
  }
  if (visible) {
    producer.materialized({ kind: 'tab', id: visible.id })
    return visible.id
  }
  const state = useAppStore.getState()
  const evidence = resolveWorkspaceExecutionEvidence(
    state,
    identity.workspaceKey,
    identity.executionHostId
  )
  if (evidence !== 'exited') {
    producer.unverifiable('Orca cannot verify the execution host for this workspace surface.')
    return null
  }
  if (!maySeedEmptySurface) {
    producer.unverifiable(
      'The activation gate found execution ownership, but its surface is not visible yet.'
    )
    return null
  }
  const primaryTabId = ensureWorktreeHasInitialTerminal(
    state,
    identity.workspaceKey,
    undefined,
    undefined,
    undefined,
    undefined,
    { reseedEmptiedWorkspace: context.mode === 'explicit' }
  )
  const materialized = primaryTabId ? readActivationRenderableSurface(identity) : null
  if (materialized) {
    producer.materialized({ kind: 'tab', id: materialized.id })
    return materialized.id
  }
  if (context.mode === 'startup' && hasLiveActivationTerminalTombstone(identity.workspaceKey)) {
    producer.intentionalEmpty()
    return null
  }
  producer.unverifiable('The activation producer did not publish a renderable surface.')
  return null
}

function clearSettledActivationOwnership(identity: WorkspaceActivationIdentity): void {
  for (const entry of readWorkspaceSurfaceProducerEntries(identity)) {
    if (entry.attempt.purpose === 'activation-recovery' && entry.result !== null) {
      discardWorkspaceSurfaceProducerAttempt(entry.attempt.id)
    }
  }
}

export function startWorkspaceActivationSurfaceProducer(
  identity: WorkspaceActivationIdentity,
  context: ActivationSurfaceProductionContext
): string | null {
  const route: WorkspaceActivationIdentity & WorktreeAgentActivationRoute = {
    ...identity,
    runtimeEnvironmentRevision: identity.runtimeEnvironmentId
      ? (getRuntimeEnvironmentRevision(identity.runtimeEnvironmentId) ?? null)
      : null
  }
  let visible: ReturnType<typeof readActivationRenderableSurface>
  try {
    visible = readActivationRenderableSurface(identity)
  } catch (error) {
    const producer = registerWorkspaceSurfaceProducer({
      workspaceKey: identity.workspaceKey,
      executionHostId: identity.executionHostId,
      purpose: 'activation-recovery'
    })
    producer.unexpected(error)
    return null
  }
  if (!isActivationExecutionRouteCurrent(route)) {
    return null
  }
  const hasSleepingSessions = workspaceHasSleepingAgentSessions(
    useAppStore.getState(),
    identity.workspaceKey
  )
  if (visible && !hasSleepingSessions) {
    return visible.id
  }
  clearSettledActivationOwnership(identity)
  if (readWorkspaceSurfaceProducerEntries(identity).length > 0) {
    return null
  }
  const producer = registerWorkspaceSurfaceProducer({
    workspaceKey: identity.workspaceKey,
    executionHostId: identity.executionHostId,
    purpose: 'activation-recovery'
  })
  if (!canInspectAgentActivationInventory(identity.runtimeEnvironmentId) && !hasSleepingSessions) {
    try {
      return settleProducedSurface(producer, route, context, true)
    } catch (error) {
      producer.unexpected(error)
      return null
    }
  }
  void gateWorktreeAgentActivation(route, {
    timeoutMs: WORKSPACE_ACTIVATION_RECOVERY_DEADLINE_MS
  }).then(
    (outcome) => {
      if (outcome === 'stale') {
        discardWorkspaceSurfaceProducerAttempt(producer.attempt.id)
        return
      }
      if (outcome === 'blocked') {
        producer.blocked(
          'Orca paused activation because the execution host did not provide complete ownership evidence.'
        )
        return
      }
      try {
        settleProducedSurface(producer, route, context, outcome === 'empty')
      } catch (error) {
        producer.unexpected(error)
      }
    },
    (error: unknown) => producer.unexpected(error)
  )
  return null
}
