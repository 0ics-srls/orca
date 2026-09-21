import type { TerminalPaneLayoutNode } from '../../../../shared/terminal-tab-types'
import { collectLeafIdsInOrder } from './terminal-layout-leaf-ids'

export type TerminalLayoutLeafClaims = {
  root: TerminalPaneLayoutNode | null
  activeLeafId?: string | null
  ptyIdsByLeafId?: Record<string, string>
}

/**
 * Leaf ids a rootless layout actually binds. The persisted map types its values as a plain
 * string, so an empty one survives the schema and is not a binding: counting it would let a
 * layout look like it holds a leaf no session is attached to.
 */
function boundLeafIds(layout: TerminalLayoutLeafClaims): string[] {
  return Object.entries(layout.ptyIdsByLeafId ?? {})
    .filter(([, ptyId]) => Boolean(ptyId))
    .map(([leafId]) => leafId)
}

/**
 * Leaf ids this layout holds, read generously: its tree, or — for a rootless layout, which binds
 * its sole pane off-tree — every leaf it binds. Use this to ask "does some pane already hold
 * this?", where over-counting only costs a reveal that adopts instead of minting.
 *
 * A binding whose leaf has left a rooted tree reattaches nothing, so it is excluded either way.
 */
export function collectOwnedLeafIds(layout: TerminalLayoutLeafClaims): Set<string> {
  return new Set(layout.root ? collectLeafIdsInOrder(layout.root) : boundLeafIds(layout))
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
  const leafIds = boundLeafIds(layout)
  const provenLeafId = leafIds.length === 1 ? leafIds[0] : layout.activeLeafId
  return new Set(leafIds.filter((leafId) => leafId === provenLeafId))
}
