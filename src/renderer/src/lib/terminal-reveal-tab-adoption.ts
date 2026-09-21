import { collectLeafIdsInOrder } from '@/components/terminal-pane/terminal-layout-leaf-ids'
import type { AppState } from '@/store/types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import {
  resolveTerminalPtyPaneOwnership,
  type TerminalPtyPaneOwnerState
} from './terminal-pty-pane-owner'
import { findTerminalTabRow } from './terminal-tab-row-lookup'

export type TerminalRevealAdoptionState = TerminalPtyPaneOwnerState &
  Pick<AppState, 'tabsByWorktree'>

/**
 * The tab whose layout owns a leaf id. Bound-and-in-tree beats in-tree-unbound, because a pane
 * keeps its leaf after its PTY exits or is cleared, and such a tab has no session to adopt.
 * Every layout is scanned, including ones whose row is gone: a leaf id is a pane identity for its
 * lifetime, and re-minting one an orphan layout still holds is how the STA-7961 pair was created.
 */
export function findTerminalTabIdBindingLeafId(
  state: Pick<AppState, 'terminalLayoutsByTabId'>,
  leafId: string
): string | null {
  let unboundCarrierTabId: string | null = null
  for (const [tabId, layout] of Object.entries(state.terminalLayoutsByTabId)) {
    const carriesLeaf = layout.root ? collectLeafIdsInOrder(layout.root).includes(leafId) : null
    if (layout.ptyIdsByLeafId?.[leafId] !== undefined && carriesLeaf !== false) {
      return tabId
    }
    if (carriesLeaf && unboundCarrierTabId === null) {
      unboundCarrierTabId = tabId
    }
  }
  return unboundCarrierTabId
}

/**
 * The tab a reveal should land on, or null to mint one. Adoption never rejects and never mints
 * for a PTY or a leaf id some layout still holds — a second tab bound to a live PTY starves a
 * pane, while a slightly wrong tab does not.
 */
export function resolveTerminalRevealTabAdoption(
  state: TerminalRevealAdoptionState,
  request: { ptyId: string; leafId?: string; hintTabId?: string }
): string | null {
  // Why: a hint naming no row is a stale baked-in paneKey, not a binding.
  const hintTabId =
    request.hintTabId !== undefined && findTerminalTabRow(state, request.hintTabId)
      ? request.hintTabId
      : undefined
  const ownership = resolveTerminalPtyPaneOwnership(state, request.ptyId, hintTabId)
  if (ownership.kind === 'owned') {
    return ownership.owner.tabId
  }
  // Why: nothing holds the PTY yet, so the tab it was minted against is the only thing left that
  // keeps paneKey hook attribution intact (#10486), and a split names its parent by that id.
  if (ownership.kind === 'none' && hintTabId !== undefined) {
    return hintTabId
  }
  // STA-7961: the PTY is unowned here, but the leaf id may already be someone's pane.
  const leafOwnerTabId = request.leafId
    ? findTerminalTabIdBindingLeafId(state, request.leafId)
    : null
  if (leafOwnerTabId !== null) {
    return leafOwnerTabId
  }
  // Why mint even when claimants exist: no layout carries this leaf id, so the bridge would
  // replace the adopted tab's whole layout with a single pane and orphan its other panes' PTYs.
  const claim =
    ownership.kind === 'ambiguous'
      ? `ptyId ${request.ptyId} is claimed by ${ownership.owners
          .map((owner) => `${owner.tabId}(${owner.tier})`)
          .join(', ')}, and no layout carries leafId ${request.leafId ?? 'none'}`
      : `no pane owns ptyId ${request.ptyId} (tabId hint ${request.hintTabId ?? 'none'}, leafId ${request.leafId ?? 'none'})`
  console.warn(`[terminal-reveal] ${claim}; minting a tab`)
  return null
}

export type TerminalRevealTargetRequest = {
  worktreeId: string
  ptyId?: string
  tabId?: string
  leafId?: string
  splitFromLeafId?: string
}

export type TerminalRevealTarget = {
  /** The row to reuse: the PTY or leaf owner, else a split reveal's parent row. */
  tab: TerminalTab | undefined
  /** The worktree key the reused row is filed under; the event's key when minting. */
  ownerWorktreeId: string
}

/**
 * The tab a reveal should land on, and the worktree key to surface it under. Ownership is
 * tab-keyed, so the owning row can sit under a worktree key other than the event's — surfacing
 * under the event's key then fails `verifyTerminalRevealIdentity` (STA-7961).
 */
export function resolveTerminalRevealTarget(
  state: TerminalRevealAdoptionState,
  request: TerminalRevealTargetRequest
): TerminalRevealTarget {
  const adoptedTabId = request.ptyId
    ? resolveTerminalRevealTabAdoption(state, {
        ptyId: request.ptyId,
        ...(request.leafId ? { leafId: request.leafId } : {}),
        ...(request.tabId !== undefined ? { hintTabId: request.tabId } : {})
      })
    : null
  const adoptedRow = adoptedTabId !== null ? findTerminalTabRow(state, adoptedTabId) : null
  if (adoptedTabId !== null && !adoptedRow) {
    // Why: minting instead would re-bind a leaf id the orphan layout still holds.
    throw new Error(`terminal_reveal_owner_row_missing: tab ${adoptedTabId}`)
  }
  const isSplitReveal = Boolean(
    request.ptyId && request.tabId && request.leafId && request.splitFromLeafId
  )
  // Why no lookup of its own: the hinted parent is adopted as the pty's owner across every
  // worktree key, so a split never needs one — a null row here means the hint names no row at all.
  if (isSplitReveal && !adoptedRow) {
    throw new Error(`Terminal tab ${request.tabId} not found`)
  }
  return { tab: adoptedRow?.tab, ownerWorktreeId: adoptedRow?.worktreeId ?? request.worktreeId }
}
