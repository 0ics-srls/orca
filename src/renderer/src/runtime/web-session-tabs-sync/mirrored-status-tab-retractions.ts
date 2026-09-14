import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { isWebTerminalSurfaceTabId } from '../../../../shared/terminal-surface-id'
import type { WebSessionTabsSyncState } from './state'
import { resolveHostSessionTabIdForWebSessionTab } from './tracking-mappings'

/** Reuse the host mapping when a status row outlives this renderer's tab inventory. */
export function collectUnhydratedMirroredTabRetractions(args: {
  state: WebSessionTabsSyncState
  environmentId: string
  worktreeId: string
  nextHostTerminalTabIds: ReadonlySet<string>
  currentTerminalIds: ReadonlySet<string>
}): string[] {
  const retracted = new Set<string>()
  for (const [paneKey, entry] of Object.entries(args.state.agentStatusByPaneKey)) {
    if (entry.worktreeId !== args.worktreeId) {
      continue
    }
    const tabId = parsePaneKey(paneKey)?.tabId
    if (!tabId || !isWebTerminalSurfaceTabId(tabId) || args.currentTerminalIds.has(tabId)) {
      continue
    }
    const hostTabId = resolveHostSessionTabIdForWebSessionTab(args.state, {
      environmentId: args.environmentId,
      worktreeId: args.worktreeId,
      tabId
    })
    // A missing mapping is unknown ownership; another host's snapshot cannot retract it.
    if (hostTabId !== null && !args.nextHostTerminalTabIds.has(hostTabId)) {
      retracted.add(tabId)
    }
  }
  return [...retracted]
}
