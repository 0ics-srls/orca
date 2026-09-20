import { collectLeafIdsInOrder } from '@/components/terminal-pane/terminal-layout-leaf-ids'
import type { AppState } from '@/store/types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import {
  resolveTerminalPtyPaneOwnership,
  type TerminalPtyPaneOwnerState
} from './terminal-pty-pane-owner'

export type TerminalRevealAdoptionState = TerminalPtyPaneOwnerState &
  Pick<AppState, 'tabsByWorktree'>

export type TerminalRevealTabAdoption =
  | { kind: 'adopt'; tabId: string; via: 'pty-owner' | 'bound-leaf' | 'ambiguity-tiebreak' }
  | { kind: 'mint' }

/**
 * The tab whose layout owns a leaf id. Bound-and-in-tree beats in-tree-unbound, because the
 * hydration self-heal leaves a losing single-leaf tab carrying its leaf with no session to adopt.
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

/** Locate a tab row and the worktree key it is filed under, across every key. */
export function findTerminalTabRow(
  state: Pick<AppState, 'tabsByWorktree'>,
  tabId: string
): { tab: TerminalTab; worktreeId: string } | null {
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (tab) {
      return { tab, worktreeId }
    }
  }
  return null
}

/**
 * Whether a reveal should adopt an existing tab or mint one. Adoption never rejects and never
 * mints for a PTY or a leaf id some layout still holds — a second tab bound to a live PTY starves
 * a pane, while a slightly wrong tab does not.
 */
export function resolveTerminalRevealTabAdoption(
  state: TerminalRevealAdoptionState,
  request: { ptyId: string; leafId?: string; hintTabId?: string }
): TerminalRevealTabAdoption {
  // Why: a hint naming no row is a stale baked-in paneKey, not a binding.
  const preferTabId =
    request.hintTabId !== undefined && findTerminalTabRow(state, request.hintTabId)
      ? { preferTabId: request.hintTabId }
      : {}
  const ownership = resolveTerminalPtyPaneOwnership(state, request.ptyId, preferTabId)
  if (ownership.kind === 'owned') {
    return { kind: 'adopt', tabId: ownership.owner.tabId, via: 'pty-owner' }
  }
  // STA-7961: the PTY is unowned here, but the leaf id may already be someone's pane.
  const leafOwnerTabId = request.leafId
    ? findTerminalTabIdBindingLeafId(state, request.leafId)
    : null
  if (leafOwnerTabId !== null) {
    return { kind: 'adopt', tabId: leafOwnerTabId, via: 'bound-leaf' }
  }
  if (ownership.kind === 'ambiguous') {
    console.warn(
      `[terminal-reveal] ptyId ${request.ptyId} is claimed by ${ownership.owners
        .map((owner) => `${owner.tabId}(${owner.tier})`)
        .join(', ')}; adopting the first`
    )
    return { kind: 'adopt', tabId: ownership.owners[0]!.tabId, via: 'ambiguity-tiebreak' }
  }
  console.warn(
    `[terminal-reveal] no pane owns ptyId ${request.ptyId} (tabId hint ${request.hintTabId ?? 'none'}, leafId ${request.leafId ?? 'none'}); minting a tab`
  )
  return { kind: 'mint' }
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
  const adoption = request.ptyId
    ? resolveTerminalRevealTabAdoption(state, {
        ptyId: request.ptyId,
        ...(request.leafId ? { leafId: request.leafId } : {}),
        ...(request.tabId !== undefined ? { hintTabId: request.tabId } : {})
      })
    : ({ kind: 'mint' } as const)
  const adoptedRow = adoption.kind === 'adopt' ? findTerminalTabRow(state, adoption.tabId) : null
  if (adoption.kind === 'adopt' && !adoptedRow) {
    // Why: minting instead would re-bind a leaf id the orphan layout still holds.
    throw new Error(`terminal_reveal_owner_row_missing: tab ${adoption.tabId}`)
  }
  const isSplitReveal = Boolean(
    request.ptyId && request.tabId && request.leafId && request.splitFromLeafId
  )
  // Why: a split of a new PTY has no owner to adopt, and its parent row can sit under another key.
  const splitTargetRow =
    isSplitReveal && request.tabId !== undefined ? findTerminalTabRow(state, request.tabId) : null
  if (isSplitReveal && !adoptedRow && !splitTargetRow) {
    throw new Error(`Terminal tab ${request.tabId} not found`)
  }
  const ownerRow = adoptedRow ?? splitTargetRow
  return { tab: ownerRow?.tab, ownerWorktreeId: ownerRow?.worktreeId ?? request.worktreeId }
}
