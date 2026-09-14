import { createBrowserUuid } from './browser-uuid'
import type {
  WorkspaceActivationContext,
  WorkspaceActivationIdentity,
  WorkspaceActivationRecoveryResult
} from './worktree-activation-recovery'

export type WorkspaceActivationRecoveryOwnerContext = WorkspaceActivationContext & {
  retry: () => void
}

type RecoverWorkspaceActivation = (
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationContext
) => Promise<WorkspaceActivationRecoveryResult>

export function createWorkspaceActivationRecoveryOwnerContext(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationContext,
  recoverWorkspaceActivation: RecoverWorkspaceActivation
): WorkspaceActivationRecoveryOwnerContext {
  return {
    ...context,
    retry: () => {
      void recoverWorkspaceActivation(
        { ...identity, attemptId: createBrowserUuid() },
        { mode: context.mode }
      )
    }
  }
}
