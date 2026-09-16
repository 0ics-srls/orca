import { agentHookServer } from '../agent-hooks/server'
import type {
  RuntimeAgentSessionCommit,
  RuntimeAgentSessionInventoryReconciliation
} from './runtime-terminal-contracts'
import { admitLocalVerifiedAgentDiscoveries } from './runtime-agent-discovery-admission'

export function publishCommittedAgentSessionMembership(commit: RuntimeAgentSessionCommit): void {
  agentHookServer.admitAgentSessionOwner({
    owner: commit.result.owner,
    paneKey: commit.paneKey,
    tabId: commit.tabId,
    worktreeId: commit.worktreeId,
    connectionId: commit.connectionId,
    terminalHandle: commit.result.owner.surface.terminalHandle,
    agentType: commit.agentType ?? commit.result.owner.claim.agent,
    launchToken: commit.launchToken,
    disposition: commit.result.disposition
  })
}

export function reconcileAgentSessionMembership(
  reconciliation: RuntimeAgentSessionInventoryReconciliation
): void {
  agentHookServer.reconcileAgentLaunchMembership(reconciliation.owners, {
    complete: reconciliation.complete,
    ...(reconciliation.connectionId !== undefined
      ? { connectionId: reconciliation.connectionId }
      : {})
  })
  // Only the execution host that supplied process and ancestry proof can adopt a manual process.
  if (reconciliation.connectionId === null) {
    admitLocalVerifiedAgentDiscoveries(reconciliation.discoveries)
  }
}
