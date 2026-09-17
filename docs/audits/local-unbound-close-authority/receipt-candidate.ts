import type { PersistedState } from '../../../src/shared/persisted-state-types'
import type { WorkspaceSessionState } from '../../../src/shared/workspace-session-state-types'
import { pruneClosedTerminalTabTombstones } from '../../../src/shared/closed-terminal-tab-tombstones'
import { closeTerminalTabInWorkspaceSession } from '../../../src/shared/workspace-session-terminal-tab-close'
import { advanceTerminalTopologyRevision } from '../../../src/main/runtime/workspace-session-terminal-membership-authority'
import { sanitizeWorkspaceSessionTerminalRetirements } from '../../../src/main/runtime/mobile-session-terminal-persistence-retirement'
import { localScope, unboundIdentity } from './candidate'

function preserveReceipts(incoming: WorkspaceSessionState, prior: WorkspaceSessionState) {
  const receipts = new Map(
    Object.values(prior.tabsByWorktree)
      .flat()
      .flatMap((row) =>
        row.rejectedLocalTabCloseAt === undefined
          ? []
          : [[row.id, row.rejectedLocalTabCloseAt] as const]
      )
  )
  return {
    ...incoming,
    tabsByWorktree: Object.fromEntries(
      Object.entries(incoming.tabsByWorktree).map(([worktree, tabs]) => [
        worktree,
        tabs.map((row) => {
          const receipt = receipts.get(row.id)
          const { rejectedLocalTabCloseAt: _untrusted, ...rest } = row
          return receipt === undefined ? rest : { ...rest, rejectedLocalTabCloseAt: receipt }
        })
      ])
    )
  }
}

export function applyUnboundCloses(
  incoming: WorkspaceSessionState,
  prior: WorkspaceSessionState | undefined,
  state: PersistedState
) {
  if (!prior) {
    return incoming
  }
  incoming = preserveReceipts(incoming, prior)
  let authority = prior
  const markers = pruneClosedTerminalTabTombstones(
    incoming.closedTerminalTabTombstonesByTabId,
    Date.now()
  )
  for (const [tabId, marker] of Object.entries(markers)) {
    const captured = marker.unboundLocalTab
    if (!captured || !localScope(state, marker.worktreeId)) {
      continue
    }
    const rows = Object.entries(authority.tabsByWorktree).flatMap(([worktree, tabs]) =>
      tabs.filter((row) => row.id === tabId).map((row) => ({ worktree, row }))
    )
    const owner = rows.length === 1 ? rows[0] : undefined
    if (
      !owner ||
      !localScope(state, owner.worktree) ||
      marker.closedAt <= (owner.row.rejectedLocalTabCloseAt ?? -1)
    ) {
      continue
    }
    const current = unboundIdentity(authority, marker.worktreeId, tabId)
    const result =
      current &&
      current.createdAt === captured.createdAt &&
      current.generation === captured.generation
        ? closeTerminalTabInWorkspaceSession(authority, marker.worktreeId, tabId)
        : null
    if (result?.closed && result.ptyIdsToKill.length === 0) {
      authority = advanceTerminalTopologyRevision(result.session, marker.worktreeId)
      continue
    }
    authority = advanceTerminalTopologyRevision(
      {
        ...authority,
        tabsByWorktree: {
          ...authority.tabsByWorktree,
          [owner.worktree]: authority.tabsByWorktree[owner.worktree].map((row) =>
            row.id === tabId ? { ...row, rejectedLocalTabCloseAt: marker.closedAt } : row
          )
        }
      },
      owner.worktree
    )
  }
  // Updated host receipts outrank renderer metadata even when the renderer carries this row.
  return sanitizeWorkspaceSessionTerminalRetirements(
    preserveReceipts(incoming, authority),
    authority
  )
}
