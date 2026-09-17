import type { WorkspaceSessionState } from '../../../src/shared/workspace-session-state-types'
import type { PersistedState } from '../../../src/shared/persisted-state-types'
import { closeTerminalTabInWorkspaceSession } from '../../../src/shared/workspace-session-terminal-tab-close'
import { advanceTerminalTopologyRevision } from '../../../src/main/runtime/workspace-session-terminal-membership-authority'
import { sanitizeWorkspaceSessionTerminalRetirements } from '../../../src/main/runtime/mobile-session-terminal-persistence-retirement'
import { pruneClosedTerminalTabTombstones } from '../../../src/shared/closed-terminal-tab-tombstones'
import {
  createRepoRowExecutionHostLookup,
  resolveWorktreeExecutionHost
} from '../../../src/shared/worktree-execution-host-resolution'
import { resolveFolderWorkspaceHost } from '../../../src/shared/folder-workspace-execution-host'
import { parseWorkspaceKey } from '../../../src/shared/workspace-scope'
import { parseExecutionHostId } from '../../../src/shared/execution-host'
import { getRepoIdFromWorktreeId } from '../../../src/shared/worktree/id'

export function unboundIdentity(
  session: Pick<
    WorkspaceSessionState,
    | 'tabsByWorktree'
    | 'terminalLayoutsByTabId'
    | 'remoteSessionIdsByTabId'
    | 'terminalPtyIncarnationsByPaneKey'
    | 'sleepingAgentSessionsByPaneKey'
  >,
  worktreeId: string,
  tabId: string
) {
  const tabs = Object.values(session.tabsByWorktree)
    .flat()
    .filter((tab) => tab.id === tabId)
  const row = session.tabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)
  const layout = session.terminalLayoutsByTabId[tabId]
  if (
    !row ||
    tabs.length !== 1 ||
    row.ptyId ||
    row.isPinned ||
    (row.generation ?? 0) !== 0 ||
    layout?.root ||
    session.remoteSessionIdsByTabId?.[tabId] ||
    [layout?.ptyIdsByLeafId, layout?.buffersByLeafId, layout?.scrollbackRefsByLeafId].some(
      (map) => Object.keys(map ?? {}).length > 0
    ) ||
    Object.keys(session.terminalPtyIncarnationsByPaneKey ?? {}).some((key) =>
      key.startsWith(`${tabId}:`)
    ) ||
    Object.entries(session.sleepingAgentSessionsByPaneKey ?? {}).some(
      ([key, value]) => key.startsWith(`${tabId}:`) || value.tabId === tabId
    )
  ) {
    return undefined
  }
  return { createdAt: row.createdAt, generation: 0 }
}

export function localScope(
  state: Pick<PersistedState, 'repos' | 'folderWorkspaces' | 'projectGroups'>,
  worktreeId: string
) {
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    const folder = state.folderWorkspaces.find((row) => row.id === scope.folderWorkspaceId)
    if (
      !folder ||
      (folder.executionHostId != null &&
        parseExecutionHostId(folder.executionHostId)?.kind !== 'local')
    ) {
      return false
    }
    return resolveFolderWorkspaceHost(state, scope.folderWorkspaceId).kind === 'local'
  }
  const result = resolveWorktreeExecutionHost(createRepoRowExecutionHostLookup(state.repos), {
    repoId: getRepoIdFromWorktreeId(scope?.type === 'worktree' ? scope.worktreeId : worktreeId)
  })
  return result.kind === 'resolved' && result.hostId === 'local'
}

// Ignored prototype: the cap/replay test intentionally demonstrates why this is not publishable.
export function applyUnboundCloses(
  incoming: WorkspaceSessionState,
  prior: WorkspaceSessionState | undefined,
  state: PersistedState
) {
  if (!prior) {
    return incoming
  }
  const newMarkers = pruneClosedTerminalTabTombstones(
    incoming.closedTerminalTabTombstonesByTabId,
    Date.now()
  )
  const kept = { ...newMarkers }
  for (const [id, marker] of Object.entries(prior.closedTerminalTabTombstonesByTabId ?? {})) {
    if (marker.unboundLocalTab && (!kept[id] || kept[id].closedAt <= marker.closedAt)) {
      kept[id] = marker
    }
  }
  let authority = prior
  for (const [tabId, marker] of Object.entries(newMarkers)) {
    const captured = marker.unboundLocalTab
    if (!captured || !localScope(state, marker.worktreeId)) {
      continue
    }
    const seen = prior.closedTerminalTabTombstonesByTabId?.[tabId]
    if (seen?.closedAt === marker.closedAt) {
      continue
    }
    const current = unboundIdentity(prior, marker.worktreeId, tabId)
    if (
      !current ||
      current.createdAt !== captured.createdAt ||
      current.generation !== captured.generation
    ) {
      continue
    }
    const result = closeTerminalTabInWorkspaceSession(authority, marker.worktreeId, tabId)
    if (result.closed && result.ptyIdsToKill.length === 0) {
      authority = advanceTerminalTopologyRevision(result.session, marker.worktreeId)
    }
  }
  return sanitizeWorkspaceSessionTerminalRetirements(
    {
      ...incoming,
      closedTerminalTabTombstonesByTabId: pruneClosedTerminalTabTombstones(kept, Date.now())
    },
    authority
  )
}
