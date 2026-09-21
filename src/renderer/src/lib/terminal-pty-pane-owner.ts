import { collectLeafIdsInOrder } from '@/components/terminal-pane/terminal-layout-leaf-ids'
import type { AppState } from '@/store/types'

/** No `tabsByWorktree`: ownership is tab-keyed, so no worktree key participates. */
export type TerminalPtyPaneOwnerState = Pick<AppState, 'terminalLayoutsByTabId' | 'ptyIdsByTabId'>

export type TerminalPtyPaneOwner = {
  tabId: string
  /** `hinted` is the PTY's baked-in tab id standing in for a binding nothing has written yet. */
  tier: 'mounted' | 'recorded' | 'hinted'
}

export type TerminalPtyPaneOwnership =
  | { kind: 'owned'; owner: TerminalPtyPaneOwner }
  | { kind: 'ambiguous'; owners: TerminalPtyPaneOwner[] }
  | { kind: 'none' }

export type TerminalPtyPaneOwnerOptions = {
  /** Tab id baked into the PTY's env; a tie-break and a last resort, never a binding. */
  preferTabId?: string
}

/**
 * Whether this tab's layout binds `ptyId` to a leaf it still holds. A rootless layout binds its
 * sole pane off-tree; a binding whose leaf has left a rooted tree reattaches nothing, so it must
 * not outrank a live pane (#13098). The persisted map types its values as a plain string, so an
 * empty one survives the schema and is not a binding — counting it would name a leaf no session
 * is attached to, and a reveal that adopted that tab would show nothing.
 */
function layoutBindsPty(state: TerminalPtyPaneOwnerState, tabId: string, ptyId: string): boolean {
  const layout = state.terminalLayoutsByTabId[tabId]
  const bindings = layout?.ptyIdsByLeafId
  if (!bindings || !ptyId) {
    return false
  }
  const treeLeafIds = layout.root ? new Set(collectLeafIdsInOrder(layout.root)) : null
  return Object.entries(bindings).some(
    ([leafId, boundPtyId]) => boundPtyId === ptyId && (treeLeafIds?.has(leafId) ?? true)
  )
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
    if (state.ptyIdsByTabId[tabId]?.includes(ptyId)) {
      mounted.push({ tabId, tier: 'mounted' })
    } else if (layoutBindsPty(state, tabId, ptyId)) {
      recorded.push({ tabId, tier: 'recorded' })
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
    ? { kind: 'owned', owner: { tabId: options.preferTabId, tier: 'hinted' } }
    : { kind: 'none' }
}
