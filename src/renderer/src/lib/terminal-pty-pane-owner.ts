import { collectOwnedLeafIds } from '@/components/terminal-pane/terminal-layout-leaf-claims'
import type { AppState } from '@/store/types'

/** No `tabsByWorktree`: ownership is tab-keyed, so no worktree key participates. */
export type TerminalPtyPaneOwnerState = Pick<AppState, 'terminalLayoutsByTabId' | 'ptyIdsByTabId'>

export type TerminalPtyPaneOwner = {
  tabId: string
  /** The leaf the layout binds; null when only the live map proves the mount. */
  leafId: string | null
  tier: 'mounted' | 'recorded'
}

export type TerminalPtyPaneOwnership =
  | { kind: 'owned'; owner: TerminalPtyPaneOwner }
  | { kind: 'ambiguous'; owners: TerminalPtyPaneOwner[] }
  | { kind: 'none' }

export type TerminalPtyPaneOwnerOptions = {
  /** Tab id baked into the PTY's env; a tie-break and a last resort, never a binding. */
  preferTabId?: string
}

/** The leaf a tab's layout binds to `ptyId`, or null when no leaf it owns holds that binding. */
function findLayoutBoundLeafId(
  state: TerminalPtyPaneOwnerState,
  tabId: string,
  ptyId: string
): string | null {
  const layout = state.terminalLayoutsByTabId[tabId]
  if (!layout?.ptyIdsByLeafId) {
    return null
  }
  const ownedLeafIds = collectOwnedLeafIds(layout)
  for (const [leafId, boundPtyId] of Object.entries(layout.ptyIdsByLeafId)) {
    if (boundPtyId === ptyId && ownedLeafIds.has(leafId)) {
      return leafId
    }
  }
  return null
}

/** Every candidate, strongest tier first; the raw input to the verdict below. */
export function listTerminalPtyPaneOwners(
  state: TerminalPtyPaneOwnerState,
  ptyId: string
): TerminalPtyPaneOwner[] {
  const mounted: TerminalPtyPaneOwner[] = []
  const recorded: TerminalPtyPaneOwner[] = []
  const tabIds = new Set([
    ...Object.keys(state.ptyIdsByTabId),
    ...Object.keys(state.terminalLayoutsByTabId)
  ])
  for (const tabId of tabIds) {
    const leafId = findLayoutBoundLeafId(state, tabId, ptyId)
    if (state.ptyIdsByTabId[tabId]?.includes(ptyId)) {
      mounted.push({ tabId, leafId, tier: 'mounted' })
    } else if (leafId !== null) {
      recorded.push({ tabId, leafId, tier: 'recorded' })
    }
  }
  // Why: object key order is persistence order, so sort to keep the verdict reproducible.
  const byTabId = (a: TerminalPtyPaneOwner, b: TerminalPtyPaneOwner): number =>
    a.tabId < b.tabId ? -1 : a.tabId > b.tabId ? 1 : 0
  return [...mounted.sort(byTabId), ...recorded.sort(byTabId)]
}

/**
 * Which pane owns a ptyId. The tab row's own `ptyId` is deliberately not a tier: the layout
 * is the binding, and a row that disagrees with it is what hands two panes one PTY (STA-7961).
 */
export function resolveTerminalPtyPaneOwnership(
  state: TerminalPtyPaneOwnerState,
  ptyId: string,
  options: TerminalPtyPaneOwnerOptions = {}
): TerminalPtyPaneOwnership {
  const owners = listTerminalPtyPaneOwners(state, ptyId)
  const mounted = owners.filter((owner) => owner.tier === 'mounted')
  const deciding = mounted.length > 0 ? mounted : owners
  if (deciding.length === 1) {
    return { kind: 'owned', owner: deciding[0]! }
  }
  if (deciding.length > 1) {
    // Why: stale duplicate ownership must not attach whichever hidden tab persisted order lists first.
    const preferred = deciding.find((owner) => owner.tabId === options.preferTabId)
    return preferred ? { kind: 'owned', owner: preferred } : { kind: 'ambiguous', owners: deciding }
  }
  // Why: nothing records the PTY yet, so the tab it was minted against is the only thing left
  // that keeps paneKey hook attribution intact (#10486).
  return options.preferTabId !== undefined
    ? { kind: 'owned', owner: { tabId: options.preferTabId, leafId: null, tier: 'recorded' } }
    : { kind: 'none' }
}
