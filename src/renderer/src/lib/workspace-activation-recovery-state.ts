import { useAppStore } from '@/store'
import { toVisibleTabType, type WorkspaceVisibleTabType } from '../../../shared/tab-types'
import { subscribeWorkspaceSurfaceProducers } from './workspace-surface-production'
import {
  getStructuredAgentLaunchStatus,
  subscribeStructuredAgentLaunchStatus
} from './structured-agent-session-launch-status'
import { AGENT_SESSION_PROVIDER_HANDLE_PROVIDERS } from '../../../shared/agent-session-provider-handle'
import {
  getExecutionHostIdForWorktree,
  getRuntimeEnvironmentIdForWorktree
} from './worktree-runtime-owner'
import type {
  WorkspaceActivationContext,
  WorkspaceActivationIdentity
} from './worktree-activation-recovery'

export type RecoveryWaitResult = 'changed' | 'cancelled' | 'timeout'

export const WORKSPACE_ACTIVATION_RECOVERY_DEADLINE_MS = 30_000
export const WORKSPACE_ACTIVATION_RECOVERY_PROGRESS_DELAY_MS = 200

const latestAttemptIdByTarget = new Map<string, string>()
const gateIdentityByPromise = new WeakMap<Promise<unknown>, string>()
let selectionRevision = 0
let previousSelectionKey: string | null = null
let disposeSelectionTracker: (() => void) | null = null

export function activationRecoveryTargetKey(identity: WorkspaceActivationIdentity): string {
  return `${identity.executionHostId}|${identity.workspaceKey}`
}

export function activationRecoveryRouteKey(identity: WorkspaceActivationIdentity): string {
  return `${identity.executionHostId}|${identity.runtimeEnvironmentId ?? ''}`
}

export function markLatestActivationRecoveryAttempt(identity: WorkspaceActivationIdentity): void {
  latestAttemptIdByTarget.set(activationRecoveryTargetKey(identity), identity.attemptId)
}

export function readLatestActivationRecoveryAttempt(
  identity: WorkspaceActivationIdentity
): string | undefined {
  return latestAttemptIdByTarget.get(activationRecoveryTargetKey(identity))
}

export function readActivationRecoveryGateRoute(gate: Promise<unknown>): string | undefined {
  return gateIdentityByPromise.get(gate)
}

export function recordActivationRecoveryGateRoute(gate: Promise<unknown>, route: string): void {
  gateIdentityByPromise.set(gate, route)
}

function currentSelectionKey(): string {
  const state = useAppStore.getState()
  const workspaceKey = state.activeWorktreeId
  if (!workspaceKey) {
    return 'none'
  }
  return `${getExecutionHostIdForWorktree(state, workspaceKey)}|${getRuntimeEnvironmentIdForWorktree(state, workspaceKey) ?? ''}|${workspaceKey}`
}

export function installActivationRecoverySelectionTracker(): void {
  if (disposeSelectionTracker) {
    return
  }
  previousSelectionKey = currentSelectionKey()
  disposeSelectionTracker = useAppStore.subscribe(() => {
    const next = currentSelectionKey()
    if (next !== previousSelectionKey) {
      previousSelectionKey = next
      selectionRevision += 1
    }
  })
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeSelectionTracker?.()
    disposeSelectionTracker = null
  })
}

export function captureActivationRecoverySelectionRevision(): number {
  return selectionRevision
}

export function isActivationRecoveryCurrent(
  identity: WorkspaceActivationIdentity,
  context: WorkspaceActivationContext
): boolean {
  if (
    context.signal?.aborted ||
    readLatestActivationRecoveryAttempt(identity) !== identity.attemptId
  ) {
    return false
  }
  const state = useAppStore.getState()
  return (
    state.activeWorktreeId === identity.workspaceKey &&
    getExecutionHostIdForWorktree(state, identity.workspaceKey) === identity.executionHostId &&
    getRuntimeEnvironmentIdForWorktree(state, identity.workspaceKey) ===
      identity.runtimeEnvironmentId
  )
}

export function isActivationRecoveryFresh(
  identity: WorkspaceActivationIdentity,
  capturedSelectionRevision: number,
  context: WorkspaceActivationContext
): boolean {
  return (
    selectionRevision === capturedSelectionRevision &&
    isActivationRecoveryCurrent(identity, context)
  )
}

export function readActivationRenderableSurface(
  identity: WorkspaceActivationIdentity
): { id: string; type: WorkspaceVisibleTabType } | null {
  const state = useAppStore.getState()
  const reconciliation = state.reconcileWorktreeTabModel(identity.workspaceKey)
  if (reconciliation.renderableTabCount === 0 || !reconciliation.activeRenderableTabId) {
    return null
  }
  const tab = (useAppStore.getState().unifiedTabsByWorktree[identity.workspaceKey] ?? []).find(
    (candidate) => candidate.id === reconciliation.activeRenderableTabId
  )
  return tab ? { id: tab.id, type: toVisibleTabType(tab.contentType) } : null
}

export function readActivationRenderableSurfaceById(
  identity: WorkspaceActivationIdentity,
  surfaceId: string
): { id: string; type: WorkspaceVisibleTabType } | null {
  const state = useAppStore.getState()
  state.reconcileWorktreeTabModel(identity.workspaceKey)
  const tab = (useAppStore.getState().unifiedTabsByWorktree[identity.workspaceKey] ?? []).find(
    (candidate) => candidate.id === surfaceId
  )
  return tab ? { id: tab.id, type: toVisibleTabType(tab.contentType) } : null
}

export function readActivationRenderableSurfaceIds(
  identity: WorkspaceActivationIdentity
): ReadonlySet<string> {
  const state = useAppStore.getState()
  state.reconcileWorktreeTabModel(identity.workspaceKey)
  return new Set(
    (useAppStore.getState().unifiedTabsByWorktree[identity.workspaceKey] ?? []).map((tab) => tab.id)
  )
}

export function readActivationRenderableInventory(identity: WorkspaceActivationIdentity): {
  renderableTabCount: number
  surface: { id: string; type: WorkspaceVisibleTabType } | null
} {
  const state = useAppStore.getState()
  const reconciliation = state.reconcileWorktreeTabModel(identity.workspaceKey)
  const tab = reconciliation.activeRenderableTabId
    ? (useAppStore.getState().unifiedTabsByWorktree[identity.workspaceKey] ?? []).find(
        (candidate) => candidate.id === reconciliation.activeRenderableTabId
      )
    : null
  return {
    renderableTabCount: reconciliation.renderableTabCount,
    surface: tab ? { id: tab.id, type: toVisibleTabType(tab.contentType) } : null
  }
}

export function hasLiveActivationTerminalTombstone(workspaceKey: string): boolean {
  return Object.hasOwn(useAppStore.getState().tabsByWorktree, workspaceKey)
}

export function readStructuredActivationProducerStatus(
  workspaceKey: string
): 'idle' | 'pending' | 'unknown' {
  let status: 'idle' | 'pending' | 'unknown' = 'idle'
  for (const agent of AGENT_SESSION_PROVIDER_HANDLE_PROVIDERS) {
    const candidate = getStructuredAgentLaunchStatus(workspaceKey, agent)
    if (candidate === 'unknown') {
      return 'unknown'
    }
    if (candidate === 'pending') {
      status = 'pending'
    }
  }
  return status
}

export function waitForActivationRecoveryChange(
  deadlineAt: number,
  signal: AbortSignal | undefined
): Promise<RecoveryWaitResult> {
  const remaining = Math.max(0, deadlineAt - Date.now())
  if (remaining === 0) {
    return Promise.resolve('timeout')
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: RecoveryWaitResult): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      unsubscribeStore()
      unsubscribeProducers()
      unsubscribeStructured()
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = (): void => finish('cancelled')
    const timeout = setTimeout(() => finish('timeout'), remaining)
    const unsubscribeStore = useAppStore.subscribe(() => finish('changed'))
    const unsubscribeProducers = subscribeWorkspaceSurfaceProducers(() => finish('changed'))
    const unsubscribeStructured = subscribeStructuredAgentLaunchStatus(() => finish('changed'))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      finish('cancelled')
    }
  })
}

export function waitForActivationRecoveryPromise<T>(
  promise: Promise<T>,
  deadlineAt: number,
  signal: AbortSignal | undefined
): Promise<
  | { kind: 'settled'; value: T }
  | { kind: 'rejected'; error: unknown }
  | Exclude<RecoveryWaitResult, 'changed'>
> {
  const remaining = Math.max(0, deadlineAt - Date.now())
  if (remaining === 0) {
    return Promise.resolve('timeout')
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (
      result:
        | { kind: 'settled'; value: T }
        | { kind: 'rejected'; error: unknown }
        | Exclude<RecoveryWaitResult, 'changed'>
    ): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = (): void => finish('cancelled')
    const timeout = setTimeout(() => finish('timeout'), remaining)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      finish('cancelled')
      return
    }
    void promise.then(
      (value) => finish({ kind: 'settled', value }),
      (error: unknown) => finish({ kind: 'rejected', error })
    )
  })
}

export function canInspectAgentActivationInventory(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.api?.runtime?.call === 'function' &&
    typeof window.api?.pty?.listSessions === 'function'
  )
}
