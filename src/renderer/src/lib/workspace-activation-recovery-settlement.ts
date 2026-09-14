import type { WorkspaceVisibleTabType } from '../../../shared/tab-types'
import {
  consumeWorkspaceSurfaceProducerAttempt,
  readWorkspaceSurfaceProducerEntries
} from './workspace-surface-production'
import {
  clearWorkspaceActivationRecoveryPresentation,
  publishWorkspaceActivationRecoveryPresentation,
  type WorkspaceActivationRecoveryPresentation
} from './workspace-activation-recovery-presentation'
import {
  isActivationRecoveryCurrent,
  readActivationRenderableSurface,
  readActivationRenderableSurfaceById,
  readActivationRenderableSurfaceIds,
  readStructuredActivationProducerStatus,
  waitForActivationRecoveryChange
} from './workspace-activation-recovery-state'
import type {
  WorkspaceActivationIdentity,
  WorkspaceActivationRecoveryOwnerContext,
  WorkspaceActivationRecoveryResult
} from './worktree-activation-recovery'

const failureSurfaceIdsByProducerAttempt = new Map<string, ReadonlySet<string>>()

export function publishActivationRecovery(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationRecoveryOwnerContext,
  kind: WorkspaceActivationRecoveryPresentation['kind'],
  detail?: string
): void {
  if (!isActivationRecoveryCurrent(identity, context)) {
    return
  }
  publishWorkspaceActivationRecoveryPresentation({
    workspaceKey: identity.workspaceKey,
    executionHostId: identity.executionHostId,
    attemptId: identity.attemptId,
    kind,
    ...(detail ? { detail } : {}),
    retry: context.retry
  })
}

export function clearActivationRecoveryPresentation(identity: WorkspaceActivationIdentity): void {
  clearWorkspaceActivationRecoveryPresentation({
    workspaceKey: identity.workspaceKey,
    executionHostId: identity.executionHostId,
    attemptId: identity.attemptId
  })
}

export function activationRecoveryMaterializedResult(
  identity: WorkspaceActivationIdentity,
  surface: { id: string; type: WorkspaceVisibleTabType }
): WorkspaceActivationRecoveryResult {
  for (const entry of readWorkspaceSurfaceProducerEntries(identity)) {
    if (
      entry.result?.kind === 'materialized' &&
      entry.result.surface.kind === 'tab' &&
      entry.result.surface.id === surface.id
    ) {
      consumeWorkspaceSurfaceProducerAttempt(entry.attempt.id)
    }
  }
  clearActivationRecoveryPresentation(identity)
  return { kind: 'materialized', surface }
}

export function activationRecoveryFailedResult(
  identity: WorkspaceActivationIdentity,
  reason: 'blocked' | 'unexpected' | 'producer-failed'
): WorkspaceActivationRecoveryResult {
  return { kind: 'failed', reason, diagnosticId: identity.attemptId }
}

export type ProducerAssessment =
  | { kind: 'complete'; result: WorkspaceActivationRecoveryResult }
  | { kind: 'idle' }
  | { kind: 'wait' }

function materializedAfterProducerFailure(
  identity: WorkspaceActivationIdentity,
  producerAttemptId: string
): WorkspaceActivationRecoveryResult | null {
  const currentSurfaceIds = readActivationRenderableSurfaceIds(identity)
  const failureSurfaceIds = failureSurfaceIdsByProducerAttempt.get(producerAttemptId)
  const laterSurfaceId = failureSurfaceIds
    ? [...currentSurfaceIds].find((surfaceId) => !failureSurfaceIds.has(surfaceId))
    : undefined
  if (laterSurfaceId) {
    const laterSurface = readActivationRenderableSurfaceById(identity, laterSurfaceId)
    if (laterSurface) {
      failureSurfaceIdsByProducerAttempt.delete(producerAttemptId)
      consumeWorkspaceSurfaceProducerAttempt(producerAttemptId)
      return activationRecoveryMaterializedResult(identity, laterSurface)
    }
  }
  if (!failureSurfaceIds) {
    failureSurfaceIdsByProducerAttempt.set(producerAttemptId, currentSurfaceIds)
  }
  return null
}

export function assessActivationProducerAttempts(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationRecoveryOwnerContext
): ProducerAssessment {
  const entries = readWorkspaceSurfaceProducerEntries(identity)
  const failed = entries.find((entry) => entry.result?.kind === 'failed')
  if (failed?.result?.kind === 'failed') {
    const laterSurface = materializedAfterProducerFailure(identity, failed.attempt.id)
    if (laterSurface) {
      return { kind: 'complete', result: laterSurface }
    }
    publishActivationRecovery(identity, context, 'producer-failed', failed.result.reason)
    return {
      kind: 'complete',
      result: activationRecoveryFailedResult(identity, 'producer-failed')
    }
  }
  const unverifiable = entries.find((entry) => entry.result?.kind === 'unverifiable')
  if (unverifiable?.result?.kind === 'unverifiable') {
    publishActivationRecovery(identity, context, 'unverifiable', unverifiable.result.reason)
    return {
      kind: 'complete',
      result: {
        kind: 'deferred',
        reason: unverifiable.result.reason,
        ownerAttemptId: unverifiable.attempt.id
      }
    }
  }
  const structuredStatus = readStructuredActivationProducerStatus(identity.workspaceKey)
  if (structuredStatus === 'unknown') {
    publishActivationRecovery(
      identity,
      context,
      'unverifiable',
      'The execution host may have accepted the surface request, but its result cannot be verified.'
    )
    return {
      kind: 'complete',
      result: {
        kind: 'deferred',
        reason: 'Structured surface ownership is unverifiable.',
        ownerAttemptId: entries.find((entry) => entry.result === null)?.attempt.id ?? null
      }
    }
  }
  const declined = entries.find((entry) => entry.result?.kind === 'declined')
  if (declined?.result?.kind === 'declined') {
    const laterSurface = materializedAfterProducerFailure(identity, declined.attempt.id)
    if (laterSurface) {
      return { kind: 'complete', result: laterSurface }
    }
    publishActivationRecovery(identity, context, 'producer-failed', declined.result.reason)
    return {
      kind: 'complete',
      result: activationRecoveryFailedResult(identity, 'producer-failed')
    }
  }
  const pending = entries.find((entry) => entry.result === null)
  if (pending || structuredStatus === 'pending') {
    return { kind: 'wait' }
  }
  const materialized = entries.find((entry) => entry.result?.kind === 'materialized')
  if (materialized?.result?.kind === 'materialized') {
    const { surface } = materialized.result
    if (surface.kind === 'workspace-content') {
      clearActivationRecoveryPresentation(identity)
      consumeWorkspaceSurfaceProducerAttempt(materialized.attempt.id)
      return {
        kind: 'complete',
        result: { kind: 'materialized', surface: { id: surface.id, type: 'workspace-content' } }
      }
    }
    const publishedSurface = readActivationRenderableSurfaceById(identity, surface.id)
    return publishedSurface
      ? {
          kind: 'complete',
          result: activationRecoveryMaterializedResult(identity, publishedSurface)
        }
      : { kind: 'wait' }
  }
  const surface = readActivationRenderableSurface(identity)
  return surface
    ? { kind: 'complete', result: activationRecoveryMaterializedResult(identity, surface) }
    : { kind: 'idle' }
}

export async function waitForActivationProducerAttempts(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationRecoveryOwnerContext,
  deadlineAt: number
): Promise<WorkspaceActivationRecoveryResult | null> {
  while (true) {
    const assessment = assessActivationProducerAttempts(identity, context)
    if (assessment.kind === 'complete') {
      return assessment.result
    }
    if (assessment.kind === 'idle') {
      return null
    }
    const entries = readWorkspaceSurfaceProducerEntries(identity)
    const pending = entries.find((entry) => entry.result === null)
    const materialized = entries.find((entry) => entry.result?.kind === 'materialized')
    const wait = await waitForActivationRecoveryChange(deadlineAt, context.signal)
    if (wait === 'cancelled') {
      return { kind: 'stale' }
    }
    if (wait === 'timeout') {
      publishActivationRecovery(
        identity,
        context,
        'unverifiable',
        'The requested surface has not become visible. Its producer still owns the attempt.'
      )
      return {
        kind: 'deferred',
        reason: 'Surface publication did not settle before the recovery deadline.',
        ownerAttemptId: pending?.attempt.id ?? materialized?.attempt.id ?? null
      }
    }
  }
}
