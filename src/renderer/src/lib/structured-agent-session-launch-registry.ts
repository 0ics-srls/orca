import { useSyncExternalStore } from 'react'
import type { AgentSessionHandleProvider } from '../../../shared/agent-session-provider-handle'
import type { StructuredAgentSessionResumeSource } from '../../../shared/structured-agent-session-create'
import type { StructuredLaunchRecoveryState } from './structured-agent-session-launch-recovery'
import type {
  StructuredAgentLaunchOptions,
  StructuredLaunchCallerGroup
} from './structured-agent-session-launch-callers'

export type StructuredLaunchState = StructuredLaunchRecoveryState & {
  identity: string
  /** Fixed by the caller that opened this launch so coalesced prompts use one delivery mode. */
  promptDelivery: StructuredAgentLaunchOptions['promptDelivery']
  callers: StructuredLaunchCallerGroup
}

export type StructuredAgentLaunchStatus = 'idle' | 'pending' | 'unknown'

const pendingStructuredLaunchesByIdentity = new Map<string, StructuredLaunchState>()
const structuredLaunchListeners = new Set<() => void>()

export function notifyStructuredLaunchListeners(): void {
  for (const listener of structuredLaunchListeners) {
    listener()
  }
}

export function subscribeStructuredAgentLaunchStatus(listener: () => void): () => void {
  structuredLaunchListeners.add(listener)
  return () => structuredLaunchListeners.delete(listener)
}

// Why keyed by agent too: one worktree can hold a Claude and a Codex launch at once.
// Why keyed by adopted conversation: a resume must not coalesce onto an unrelated blank launch.
export function structuredLaunchIdentity(
  worktreeId: string,
  agent: AgentSessionHandleProvider,
  resumeFrom?: StructuredAgentSessionResumeSource
): string {
  return resumeFrom
    ? `${agent}:${worktreeId}:resume:${resumeFrom.providerSessionId}`
    : `${agent}:${worktreeId}`
}

export function getStructuredLaunchState(identity: string): StructuredLaunchState | undefined {
  return pendingStructuredLaunchesByIdentity.get(identity)
}

export function setStructuredLaunchState(state: StructuredLaunchState): void {
  pendingStructuredLaunchesByIdentity.set(state.identity, state)
}

export function deleteStructuredLaunchStateIfCurrent(state: StructuredLaunchState): boolean {
  if (pendingStructuredLaunchesByIdentity.get(state.identity) !== state) {
    return false
  }
  pendingStructuredLaunchesByIdentity.delete(state.identity)
  return true
}

export function structuredLaunchStates(): IterableIterator<StructuredLaunchState> {
  return pendingStructuredLaunchesByIdentity.values()
}

export function getStructuredAgentLaunchStatus(
  worktreeId: string,
  agent: AgentSessionHandleProvider
): StructuredAgentLaunchStatus {
  // Any launch for this pair, including adopted conversations, means a chat is starting here.
  const states = [
    getStructuredLaunchState(structuredLaunchIdentity(worktreeId, agent)),
    ...[...pendingStructuredLaunchesByIdentity.entries()]
      .filter(([identity]) => identity.startsWith(`${agent}:${worktreeId}:resume:`))
      .map(([, state]) => state)
  ].filter((state): state is StructuredLaunchState => Boolean(state))
  if (states.length === 0) {
    return 'idle'
  }
  return states.some((state) => state.visibilityUnknown) ? 'unknown' : 'pending'
}

export function useStructuredAgentLaunchStatus(
  worktreeId: string,
  agent: AgentSessionHandleProvider
): StructuredAgentLaunchStatus {
  return useSyncExternalStore(
    subscribeStructuredAgentLaunchStatus,
    () => getStructuredAgentLaunchStatus(worktreeId, agent),
    () => 'idle'
  )
}
