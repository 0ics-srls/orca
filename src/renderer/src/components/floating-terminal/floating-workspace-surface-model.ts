import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import type { AppState } from '@/store/types'

export type FloatingWorkspaceSurfaceModel =
  | { kind: 'empty' }
  | { kind: 'workspace'; layout: TabGroupLayoutNode; focusedGroupId: string }

type FloatingWorkspaceSurfaceState = Pick<
  AppState,
  'unifiedTabsByWorktree' | 'groupsByWorktree' | 'layoutByWorktree' | 'activeGroupIdByWorktree'
>

/**
 * Decides emptiness and layout for the floating panel body atomically.
 *
 * An empty floating workspace has no layout at all: `layoutByWorktree` starts empty and
 * hydration skips workspaces without tabs — while the shared group tree requires a layout.
 * So the panel renders its empty state exactly until the first tab exists; tab creation and
 * hydration both write a layout with the tab, which flips this to a mountable workspace.
 */
export function resolveFloatingWorkspaceSurfaceModel(
  state: FloatingWorkspaceSurfaceState
): FloatingWorkspaceSurfaceModel {
  const tabs = state.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]
  const layout = state.layoutByWorktree[FLOATING_TERMINAL_WORKTREE_ID]
  if (!tabs || tabs.length === 0 || !layout) {
    return { kind: 'empty' }
  }
  const groups = state.groupsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []
  const storedFocusId = state.activeGroupIdByWorktree[FLOATING_TERMINAL_WORKTREE_ID]
  const focusedGroupId =
    (storedFocusId && groups.some((group) => group.id === storedFocusId) ? storedFocusId : null) ??
    groups.find((group) => group.activeTabId != null)?.id ??
    groups[0]?.id
  if (!focusedGroupId) {
    return { kind: 'empty' }
  }
  return { kind: 'workspace', layout, focusedGroupId }
}
