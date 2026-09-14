import { gateWorktreeAgentActivation } from './worktree-agent-activation-gate'
import type {
  WorkspaceActivationContext,
  WorkspaceActivationIdentity,
  WorkspaceActivationRecoveryResult
} from './worktree-activation-recovery'
import {
  activationRecoveryRouteKey,
  readActivationRecoveryGateRoute,
  readActivationRenderableSurface,
  recordActivationRecoveryGateRoute,
  waitForActivationRecoveryChange,
  waitForActivationRecoveryPromise
} from './workspace-activation-recovery-state'
import {
  activationRecoveryFailedResult,
  activationRecoveryMaterializedResult,
  publishActivationRecovery
} from './workspace-activation-recovery-settlement'

export async function runActivationRecoveryGate(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationContext,
  deadlineAt: number
): Promise<WorkspaceActivationRecoveryResult | 'empty' | 'produced'> {
  const gate = gateWorktreeAgentActivation(identity.workspaceKey)
  const gateRoute = readActivationRecoveryGateRoute(gate)
  if (gateRoute && gateRoute !== activationRecoveryRouteKey(identity)) {
    publishActivationRecovery(
      identity,
      context,
      'unverifiable',
      'Another execution host owns the in-progress recovery assessment. Retry after it settles.'
    )
    return {
      kind: 'deferred',
      reason: 'A recovery gate from another execution host is still in progress.',
      ownerAttemptId: null
    }
  }
  recordActivationRecoveryGateRoute(gate, activationRecoveryRouteKey(identity))
  const outcome = await waitForActivationRecoveryPromise(gate, deadlineAt, context.signal)
  if (outcome === 'cancelled') {
    return { kind: 'stale' }
  }
  if (outcome === 'timeout') {
    publishActivationRecovery(
      identity,
      context,
      'unexpected',
      'Workspace inventory did not finish before the recovery deadline.'
    )
    return activationRecoveryFailedResult(identity, 'unexpected')
  }
  if (outcome.kind === 'rejected') {
    const detail = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
    publishActivationRecovery(identity, context, 'unexpected', detail)
    return activationRecoveryFailedResult(identity, 'unexpected')
  }
  if (outcome.value === 'blocked') {
    publishActivationRecovery(
      identity,
      context,
      'blocked',
      'Orca deliberately paused recovery because the execution host did not provide complete ownership evidence.'
    )
    return activationRecoveryFailedResult(identity, 'blocked')
  }
  return outcome.value === 'empty' ? 'empty' : 'produced'
}

export async function waitForActivationProducedSurface(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationContext,
  deadlineAt: number
): Promise<WorkspaceActivationRecoveryResult> {
  while (true) {
    const surface = readActivationRenderableSurface(identity)
    if (surface) {
      return activationRecoveryMaterializedResult(identity, surface)
    }
    const wait = await waitForActivationRecoveryChange(deadlineAt, context.signal)
    if (wait === 'cancelled') {
      return { kind: 'stale' }
    }
    if (wait === 'timeout') {
      publishActivationRecovery(
        identity,
        context,
        'unverifiable',
        'The execution host reported work, but no renderable surface became visible.'
      )
      return {
        kind: 'deferred',
        reason: 'Host work did not publish a renderable surface before the recovery deadline.',
        ownerAttemptId: null
      }
    }
  }
}
