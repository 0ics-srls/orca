import type { ExecutionHostId } from '../../../shared/execution-host'
import type { WorkspaceVisibleTabType } from '../../../shared/tab-types'
import { createBrowserUuid } from './browser-uuid'
import { recoverWorkspaceActivationOwned } from './workspace-activation-recovery-coordinator'
import {
  markLatestActivationRecoveryAttempt,
  readLatestActivationRecoveryAttempt
} from './workspace-activation-recovery-state'
import {
  activationRecoveryFailedResult,
  publishActivationRecovery
} from './workspace-activation-recovery-settlement'

export type WorkspaceActivationIdentity = {
  workspaceKey: string
  executionHostId: ExecutionHostId
  runtimeEnvironmentId: string | null
  attemptId: string
}

export type WorkspaceActivationContext = {
  mode: 'explicit' | 'startup'
  signal?: AbortSignal
}

export type WorkspaceActivationRecoveryOwnerContext = WorkspaceActivationContext & {
  retry: () => void
}

export type WorkspaceActivationRecoveryResult =
  | {
      kind: 'materialized'
      surface: { id: string; type: WorkspaceVisibleTabType | 'workspace-content' }
    }
  | { kind: 'intentional-empty' }
  | { kind: 'deferred'; reason: string; ownerAttemptId: string | null }
  | { kind: 'failed'; reason: 'blocked' | 'unexpected' | 'producer-failed'; diagnosticId: string }
  | { kind: 'stale' }

export async function recoverWorkspaceActivation(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationContext
): Promise<WorkspaceActivationRecoveryResult> {
  const ownerContext: WorkspaceActivationRecoveryOwnerContext = {
    ...context,
    retry: () => {
      void recoverWorkspaceActivation(
        { ...identity, attemptId: createBrowserUuid() },
        { mode: context.mode }
      )
    }
  }
  try {
    return await recoverWorkspaceActivationOwned(identity, ownerContext)
  } catch (error) {
    const currentAttemptId = readLatestActivationRecoveryAttempt(identity)
    if (currentAttemptId && currentAttemptId !== identity.attemptId) {
      return { kind: 'stale' }
    }
    markLatestActivationRecoveryAttempt(identity)
    const detail = error instanceof Error ? error.message : String(error)
    try {
      publishActivationRecovery(identity, ownerContext, 'unexpected', detail)
    } catch (presentationError) {
      console.error('workspace activation recovery presentation failed', presentationError)
    }
    return activationRecoveryFailedResult(identity, 'unexpected')
  }
}
