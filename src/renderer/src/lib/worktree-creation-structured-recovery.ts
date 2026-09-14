import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import { completeWorktreeCreation } from '@/lib/worktree-creation-completion'
import { launchStructuredWorktreeSession } from '@/lib/worktree-creation-structured-session'
import type { AgentSessionHandleProvider } from '../../../shared/agent-session-provider-handle'
import { isAgentSessionHandleProvider } from '../../../shared/agent-session-provider-handle'
import { structuredAgentLabel } from '@/lib/structured-agent-session-launch-label'

export function markStructuredWorktreeLaunchUnconfirmed(
  creationId: string,
  worktreeId: string,
  agent: AgentSessionHandleProvider
): void {
  useAppStore.getState().updatePendingWorktreeCreation(creationId, {
    status: 'error',
    error: translate(
      'auto.lib.worktree.creation.flow.structured.launch.unknown',
      'Could not confirm whether {{value0}} chat opened. Retry to check again.',
      { value0: structuredAgentLabel(agent) }
    ),
    structuredLaunchRecoveryWorktreeId: worktreeId
  })
}

export async function retryStructuredWorktreeLaunch(
  creationId: string,
  request: WorktreeCreationRequest,
  worktreeId: string
): Promise<void> {
  if (!useAppStore.getState().pendingWorktreeCreations[creationId]) {
    return
  }
  const { agentLaunchRoute } = request
  // Why: this lane is entered only from an unconfirmed structured launch, so the persisted verdict
  // is that route; any other one names no session to reconcile.
  if (agentLaunchRoute !== 'structured-native-chat') {
    return
  }
  const agent = request.agent
  if (!isAgentSessionHandleProvider(agent)) {
    return
  }
  const structuredSession = await launchStructuredWorktreeSession({
    creationId,
    request,
    agentLaunchRoute,
    worktreeId,
    shouldActivateOnCompletion: true,
    activation: false,
    primaryTabId: null,
    recoverUnknownLaunch: true
  })
  if (structuredSession.cancelled) {
    return
  }
  if (structuredSession.visibilityUnknown) {
    markStructuredWorktreeLaunchUnconfirmed(creationId, worktreeId, agent)
    return
  }
  await completeWorktreeCreation({
    creationId,
    request,
    worktreeId,
    structuredLaunchAccepted: structuredSession.accepted,
    activation: structuredSession.activation,
    primaryTabId: structuredSession.primaryTabId,
    backendSpawned: false,
    focusOnCompletion: true
  })
}
