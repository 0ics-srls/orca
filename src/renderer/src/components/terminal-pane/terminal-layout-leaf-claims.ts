import type { TerminalPaneLayoutNode } from '../../../../shared/terminal-tab-types'
import { collectLeafIdsInOrder } from './terminal-layout-leaf-ids'

export type TerminalLayoutLeafClaims = {
  root: TerminalPaneLayoutNode | null
  activeLeafId?: string | null
  ptyIdsByLeafId?: Record<string, string>
}

/**
 * Leaf ids this layout holds, read generously: its tree, or — for a rootless layout, which binds
 * its sole pane off-tree — every leaf it binds. Use this to ask "does some pane already hold
 * this?", where over-counting only costs a reveal that adopts instead of minting.
 *
 * A binding whose leaf has left a rooted tree reattaches nothing, so it is excluded either way.
 */
export function collectOwnedLeafIds(layout: TerminalLayoutLeafClaims): Set<string> {
  return new Set(
    layout.root ? collectLeafIdsInOrder(layout.root) : Object.keys(layout.ptyIdsByLeafId ?? {})
  )
}

/**
 * Leaf ids this layout may take from another tab, read narrowly. Same as the owned set for a
 * rooted layout, but a rootless one proves only its sole off-tree pane, or the one its
 * `activeLeafId` names: a never-pruned map holds more than it owns, and claiming those evicts
 * the live row that really owns them (#13098). Mirrors the `owned`/`claimable` split in
 * `terminal-session-row-hydration.ts`, which is the guard that caught #13060.
 */
export function collectClaimableLeafIds(layout: TerminalLayoutLeafClaims): Set<string> {
  if (layout.root) {
    return new Set(collectLeafIdsInOrder(layout.root))
  }
  const boundLeafIds = Object.keys(layout.ptyIdsByLeafId ?? {})
  const provenLeafId = boundLeafIds.length === 1 ? boundLeafIds[0] : layout.activeLeafId
  return new Set(boundLeafIds.filter((leafId) => leafId === provenLeafId))
}
