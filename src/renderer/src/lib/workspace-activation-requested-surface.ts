import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { resumeSleepingAgentSessionsForWorktree } from './resume-sleeping-agent-session'
import type { WorkspaceActivationIdentity } from './worktree-activation-recovery'
import {
  captureActivationRenderableSurfaceIds,
  settleActivationSeedProducer
} from './worktree-activation-recovery-routing'
import { isActivationExecutionRouteCurrent } from './workspace-activation-recovery-state'
import type { WorkspaceExecutionEvidence } from './workspace-execution-evidence'
import {
  consumeWorkspaceSurfaceProducerAttempt,
  registerWorkspaceSurfaceProducer
} from './workspace-surface-production'

type RequestedSurfaceOwner = 'local' | 'runtime-transfer' | 'backend-confirmed'

type RequestedSurfaceProduction = {
  identity: WorkspaceActivationIdentity
  executionEvidence: WorkspaceExecutionEvidence
  owner: RequestedSurfaceOwner
  createSurface: () => string | null
}

export function produceRequestedWorkspaceSurface({
  identity,
  executionEvidence,
  owner,
  createSurface
}: RequestedSurfaceProduction): string | null {
  const producer = registerWorkspaceSurfaceProducer(identity)
  if (owner === 'runtime-transfer') {
    try {
      createSurface()
      producer.declined('Surface production transferred to the paired execution host.')
      consumeWorkspaceSurfaceProducerAttempt(producer.attempt.id)
    } catch (error) {
      producer.failed(error)
    }
    return null
  }
  if (owner === 'backend-confirmed') {
    try {
      const primaryTabId = createSurface()
      if (primaryTabId) {
        producer.materialized({ kind: 'tab', id: primaryTabId })
      } else {
        producer.unverifiable(
          'The execution host accepted the startup, but its surface is not visible yet.'
        )
      }
      return primaryTabId
    } catch (error) {
      producer.failed(error)
      return null
    }
  }
  if (executionEvidence !== 'exited') {
    producer.unverifiable('Orca cannot verify the execution host for this requested surface.')
    return null
  }
  const route = {
    ...identity,
    runtimeEnvironmentRevision: identity.runtimeEnvironmentId
      ? (getRuntimeEnvironmentRevision(identity.runtimeEnvironmentId) ?? null)
      : null
  }
  try {
    const existingSurfaceIds = captureActivationRenderableSurfaceIds(identity.workspaceKey)
    resumeSleepingAgentSessionsForWorktree(identity.workspaceKey, {
      expectedExecutionHostId: route.executionHostId,
      expectedRuntimeEnvironmentId: route.runtimeEnvironmentId,
      ...(route.runtimeEnvironmentRevision === null
        ? {}
        : { expectedRuntimeEnvironmentRevision: route.runtimeEnvironmentRevision })
    })
    if (!isActivationExecutionRouteCurrent(route)) {
      producer.unverifiable('The workspace execution route changed before surface creation.')
      return null
    }
    const primaryTabId = createSurface()
    settleActivationSeedProducer(producer, identity.workspaceKey, primaryTabId, existingSurfaceIds)
    return primaryTabId
  } catch (error) {
    producer.failed(error)
    return null
  }
}
