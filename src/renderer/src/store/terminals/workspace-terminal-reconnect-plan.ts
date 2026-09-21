import type { Repo } from '../../../../shared/repo-types'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'
import { collectOwnedLeafIds } from '@/components/terminal-pane/terminal-layout-leaf-claims'
import { buildByIdIndex, buildWorktreeByIdIndex } from '../slices/worktree-by-id-index'
import { resolvePrimaryLayoutPtyId } from './terminal-pty-identities'

export type WorkspaceTerminalReconnectPlan = {
  pendingReconnectPtyIdByTabId: Record<string, string>
  pendingReconnectTabByWorktree: Record<string, string[]>
  pendingReconnectWorktreeIds: string[]
}

export function buildWorkspaceTerminalReconnectPlan({
  layoutsByTabId,
  reconnectPtyIdByRetainedTabId,
  releasedPtyIdsByTabId,
  repos,
  session,
  validTabIds,
  validWorktreeIds,
  worktreesByRepo
}: {
  layoutsByTabId: Record<string, TerminalLayoutSnapshot>
  reconnectPtyIdByRetainedTabId: ReadonlyMap<string, string>
  releasedPtyIdsByTabId: ReadonlyMap<string, ReadonlySet<string>>
  repos: readonly Repo[]
  session: WorkspaceSessionState
  validTabIds: ReadonlySet<string>
  validWorktreeIds: ReadonlySet<string>
  worktreesByRepo: Record<string, Worktree[]>
}): WorkspaceTerminalReconnectPlan {
  // The shutdown list is authoritative when present; PTY ids are wake hints, not activity state.
  const shutdownIds =
    session.activeWorktreeIdsOnShutdown ??
    Object.entries(session.tabsByWorktree)
      .filter(([, tabs]) => tabs.some((tab) => tab.ptyId))
      .map(([worktreeId]) => worktreeId)
  const pendingReconnectWorktreeIds = shutdownIds.filter((id) => validWorktreeIds.has(id))
  const remoteSessionIds = session.remoteSessionIdsByTabId ?? {}
  const pendingReconnectTabByWorktree: Record<string, string[]> = {}
  for (const worktreeId of pendingReconnectWorktreeIds) {
    const liveTabIds = (session.tabsByWorktree[worktreeId] ?? [])
      .filter(
        (tab) =>
          (tab.ptyId || remoteSessionIds[tab.id] || reconnectPtyIdByRetainedTabId.has(tab.id)) &&
          validTabIds.has(tab.id)
      )
      .map((tab) => tab.id)
    if (liveTabIds.length > 0) {
      pendingReconnectTabByWorktree[worktreeId] = liveTabIds
    }
  }

  const pendingReconnectPtyIdByTabId: Record<string, string> = {}
  const worktreeById = buildWorktreeByIdIndex(worktreesByRepo)
  const repoById = buildByIdIndex(repos)
  for (const worktreeId of pendingReconnectWorktreeIds) {
    const worktree = worktreeById.get(worktreeId)
    const repo = worktree ? repoById.get(worktree.repoId) : null
    // SSH sessions reconnect through their relay rather than the local daemon.
    if (repo?.connectionId) {
      continue
    }
    for (const tab of session.tabsByWorktree[worktreeId] ?? []) {
      // Why: the layout is the binding, so a row whose layout surrendered its PTY has nothing to
      // reattach. A layout with no bindings map at all predates leaf bindings; only that shape
      // still answers from the row.
      const layout = layoutsByTabId[tab.id]
      const reconnectPtyId =
        layout?.ptyIdsByLeafId === undefined ? tab.ptyId : resolvePrimaryLayoutPtyId(layout)
      if (
        reconnectPtyId &&
        validTabIds.has(tab.id) &&
        !releasedPtyIdsByTabId.get(tab.id)?.has(reconnectPtyId)
      ) {
        pendingReconnectPtyIdByTabId[tab.id] = reconnectPtyId
      }
    }
  }
  // Why indexed: the relay wake handle is a separate fact from the layout, but it must not hand a
  // tab the very PTY another tab's healed layout binds — that is the duplicate mount reached
  // through a second door. A wake nothing else binds is untouched, which is every normal one.
  //
  // Why owned leaves only: a binding whose leaf left the tree reattaches nothing, so blocking on
  // it would cost a real remote session its restore for no gain. And why an id match is enough:
  // the row, the leaf binding and the relay handle are all written from one spawn id
  // (`updateTabPtyId`) and rewritten together by `ssh-target-id-migration.ts`, so the index
  // cannot miss on id form.
  const tabIdsBindingPtyId = new Map<string, Set<string>>()
  for (const [tabId, layout] of Object.entries(layoutsByTabId)) {
    const ownedLeafIds = collectOwnedLeafIds(layout)
    for (const [leafId, ptyId] of Object.entries(layout.ptyIdsByLeafId ?? {})) {
      if (!ptyId || !ownedLeafIds.has(leafId)) {
        continue
      }
      const binders = tabIdsBindingPtyId.get(ptyId)
      if (binders) {
        binders.add(tabId)
      } else {
        tabIdsBindingPtyId.set(ptyId, new Set([tabId]))
      }
    }
  }
  for (const [tabId, sessionId] of Object.entries(remoteSessionIds)) {
    const binders = tabIdsBindingPtyId.get(sessionId)
    if (
      validTabIds.has(tabId) &&
      !releasedPtyIdsByTabId.get(tabId)?.has(sessionId) &&
      (binders === undefined || binders.has(tabId))
    ) {
      pendingReconnectPtyIdByTabId[tabId] = sessionId
    }
  }
  // Retained split rows need an owned leaf PTY anchor until their pane remounts.
  for (const [tabId, ptyId] of reconnectPtyIdByRetainedTabId) {
    if (validTabIds.has(tabId) && !pendingReconnectPtyIdByTabId[tabId]) {
      pendingReconnectPtyIdByTabId[tabId] = ptyId
    }
  }

  return {
    pendingReconnectPtyIdByTabId,
    pendingReconnectTabByWorktree,
    pendingReconnectWorktreeIds
  }
}
