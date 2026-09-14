import { useAppStore } from '@/store'
import { shouldAutoCreateInitialTerminal } from '@/components/terminal/initial-terminal'
import { clearWorkspaceActivationRecoveryPresentation } from './workspace-activation-recovery-presentation'
import { readWorkspaceSurfaceProducerEntries } from './workspace-surface-production'
import {
  resolveWorkspaceExecutionEvidence,
  type WorkspaceExecutionEvidence
} from './workspace-execution-evidence'
import type {
  WorkspaceActivationIdentity,
  WorkspaceActivationRecoveryResult
} from './worktree-activation-recovery'
import type { WorkspaceActivationRecoveryOwnerContext } from './workspace-activation-recovery-retry'
import {
  canInspectAgentActivationInventory,
  captureActivationRecoverySelectionRevision,
  hasLiveActivationTerminalTombstone,
  installActivationRecoverySelectionTracker,
  isActivationRecoveryFresh,
  markLatestActivationRecoveryAttempt,
  readActivationRenderableInventory,
  readActivationRenderableSurface,
  WORKSPACE_ACTIVATION_RECOVERY_DEADLINE_MS,
  WORKSPACE_ACTIVATION_RECOVERY_PROGRESS_DELAY_MS
} from './workspace-activation-recovery-state'
import {
  activationRecoveryFailedResult,
  activationRecoveryMaterializedResult,
  assessActivationProducerAttempts,
  clearActivationRecoveryPresentation,
  publishActivationRecovery,
  waitForActivationProducerAttempts
} from './workspace-activation-recovery-settlement'
import {
  runActivationRecoveryGate,
  waitForActivationProducedSurface
} from './workspace-activation-recovery-gate'

let seedingTargetKey: string | null = null

function seedPrivateRecoverySurface(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationRecoveryOwnerContext,
  capturedSelectionRevision: number
): WorkspaceActivationRecoveryResult {
  const key = `${identity.executionHostId}|${identity.workspaceKey}`
  if (
    !isActivationRecoveryFresh(identity, capturedSelectionRevision, context) ||
    seedingTargetKey === key
  ) {
    return { kind: 'stale' }
  }
  seedingTargetKey = key
  try {
    const { renderableTabCount, surface } = readActivationRenderableInventory(identity)
    // Why: reconciliation can synchronously notify subscribers and start a newer activation.
    if (!isActivationRecoveryFresh(identity, capturedSelectionRevision, context)) {
      return { kind: 'stale' }
    }
    if (surface) {
      return activationRecoveryMaterializedResult(identity, surface)
    }
    if (renderableTabCount > 0) {
      publishActivationRecovery(
        identity,
        context,
        'unexpected',
        'Workspace content exists, but no renderable surface could be selected.'
      )
      return activationRecoveryFailedResult(identity, 'unexpected')
    }
    if (context.mode === 'startup' && hasLiveActivationTerminalTombstone(identity.workspaceKey)) {
      clearActivationRecoveryPresentation(identity)
      return { kind: 'intentional-empty' }
    }
    const pendingProducer = readWorkspaceSurfaceProducerEntries(identity).find(
      (entry) => entry.result === null || entry.result?.kind === 'unverifiable'
    )
    if (pendingProducer) {
      publishActivationRecovery(
        identity,
        context,
        'unverifiable',
        'A surface producer still owns this workspace.'
      )
      return {
        kind: 'deferred',
        reason: 'A surface producer still owns this workspace.',
        ownerAttemptId: pendingProducer.attempt.id
      }
    }
    const evidence: WorkspaceExecutionEvidence = resolveWorkspaceExecutionEvidence(
      useAppStore.getState(),
      identity.workspaceKey,
      identity.executionHostId
    )
    if (evidence !== 'exited') {
      const detail =
        evidence === 'live'
          ? 'The execution host owns this workspace surface. Wait for it to publish or reconnect.'
          : 'Orca cannot verify the execution host. Reconnect before retrying recovery.'
      publishActivationRecovery(identity, context, 'unverifiable', detail)
      return { kind: 'deferred', reason: detail, ownerAttemptId: null }
    }
    if (!shouldAutoCreateInitialTerminal(renderableTabCount, false)) {
      publishActivationRecovery(
        identity,
        context,
        'unexpected',
        'Workspace recovery could not select a surface.'
      )
      return activationRecoveryFailedResult(identity, 'unexpected')
    }
    const tab = useAppStore.getState().createTab(identity.workspaceKey, undefined, undefined, {
      pendingActivationSpawn: true
    })
    clearActivationRecoveryPresentation(identity)
    return { kind: 'materialized', surface: { id: tab.id, type: 'terminal' } }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    publishActivationRecovery(identity, context, 'unexpected', detail)
    return activationRecoveryFailedResult(identity, 'unexpected')
  } finally {
    seedingTargetKey = null
  }
}

export async function recoverWorkspaceActivationOwned(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationRecoveryOwnerContext
): Promise<WorkspaceActivationRecoveryResult> {
  installActivationRecoverySelectionTracker()
  markLatestActivationRecoveryAttempt(identity)
  clearWorkspaceActivationRecoveryPresentation({
    workspaceKey: identity.workspaceKey,
    executionHostId: identity.executionHostId
  })
  const capturedSelectionRevision = captureActivationRecoverySelectionRevision()
  const deadlineAt = Date.now() + WORKSPACE_ACTIVATION_RECOVERY_DEADLINE_MS
  const progressTimer = setTimeout(() => {
    try {
      if (
        isActivationRecoveryFresh(identity, capturedSelectionRevision, context) &&
        !readActivationRenderableSurface(identity)
      ) {
        publishActivationRecovery(identity, context, 'recovering')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      publishActivationRecovery(identity, context, 'unexpected', detail)
    }
  }, WORKSPACE_ACTIVATION_RECOVERY_PROGRESS_DELAY_MS)
  try {
    if (!isActivationRecoveryFresh(identity, capturedSelectionRevision, context)) {
      return { kind: 'stale' }
    }
    const producerAssessment = assessActivationProducerAttempts(identity, context)
    const producerResult =
      producerAssessment.kind === 'wait'
        ? await waitForActivationProducerAttempts(identity, context, deadlineAt)
        : producerAssessment.kind === 'complete'
          ? producerAssessment.result
          : null
    if (producerResult) {
      return producerResult
    }
    if (!isActivationRecoveryFresh(identity, capturedSelectionRevision, context)) {
      return { kind: 'stale' }
    }
    const state = useAppStore.getState()
    const shouldGate =
      Object.values(state.sleepingAgentSessionsByPaneKey).some(
        (record) => record.worktreeId === identity.workspaceKey
      ) || canInspectAgentActivationInventory()
    if (shouldGate) {
      const gateResult = await runActivationRecoveryGate(identity, context, deadlineAt)
      if (gateResult !== 'empty' && gateResult !== 'produced') {
        return gateResult
      }
      if (!isActivationRecoveryFresh(identity, capturedSelectionRevision, context)) {
        return { kind: 'stale' }
      }
      const gateSurface = readActivationRenderableSurface(identity)
      if (gateSurface) {
        return activationRecoveryMaterializedResult(identity, gateSurface)
      }
      if (gateResult === 'produced') {
        return waitForActivationProducedSurface(identity, context, deadlineAt)
      }
    }
    const seedResult = seedPrivateRecoverySurface(identity, context, capturedSelectionRevision)
    if (
      seedResult.kind !== 'stale' ||
      !isActivationRecoveryFresh(identity, capturedSelectionRevision, context)
    ) {
      return seedResult
    }
    // Why: a reentrant subscriber can start the newer attempt while the superseded attempt still
    // owns the synchronous seed guard; retry once after that critical section unwinds.
    await Promise.resolve()
    return seedPrivateRecoverySurface(identity, context, capturedSelectionRevision)
  } catch (error) {
    if (!isActivationRecoveryFresh(identity, capturedSelectionRevision, context)) {
      return { kind: 'stale' }
    }
    const detail = error instanceof Error ? error.message : String(error)
    publishActivationRecovery(identity, context, 'unexpected', detail)
    return activationRecoveryFailedResult(identity, 'unexpected')
  } finally {
    clearTimeout(progressTimer)
  }
}
