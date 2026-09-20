import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/terminal-tab-types'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'
import { detachTerminalLayoutLeaf } from '@/components/terminal-pane/terminal-layout-leaf-detach'
import {
  collectLeafIdsInOrder,
  resolvePtyBoundActiveLeafId
} from '@/components/terminal-pane/terminal-layout-leaf-ids'

type TerminalLayoutOwnerRanking = {
  canonicalTabIds: ReadonlySet<string>
  tabById: ReadonlyMap<string, TerminalTab>
}

/** Terminal rows the unified tab model still lists, across every workspace key. */
export function readCanonicalTerminalTabIds(session: WorkspaceSessionState): Set<string> {
  const tabIds = new Set<string>()
  for (const tabs of Object.values(session.unifiedTabs ?? {})) {
    for (const tab of tabs) {
      if (tab.contentType === 'terminal') {
        tabIds.add(tab.entityId)
      }
    }
  }
  return tabIds
}

// Why MAX_SAFE_INTEGER: a tab id with no surviving row ranks behind every row that has one.
const MISSING_ROW_RANK = Number.MAX_SAFE_INTEGER

/** Canonical row, then the order the user put them in, then the older row, then the id. */
function compareOwnerTabIds(a: string, b: string, ranking: TerminalLayoutOwnerRanking): number {
  const canonical =
    Number(!ranking.canonicalTabIds.has(a)) - Number(!ranking.canonicalTabIds.has(b))
  if (canonical !== 0) {
    return canonical
  }
  const aTab = ranking.tabById.get(a)
  const bTab = ranking.tabById.get(b)
  const sortOrder = (aTab?.sortOrder ?? MISSING_ROW_RANK) - (bTab?.sortOrder ?? MISSING_ROW_RANK)
  if (sortOrder !== 0) {
    return sortOrder
  }
  const createdAt = (aTab?.createdAt ?? MISSING_ROW_RANK) - (bTab?.createdAt ?? MISSING_ROW_RANK)
  if (createdAt !== 0) {
    return createdAt
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/** Leaf ids this layout claims as pane identities. A binding off the tree reattaches nothing. */
function collectHeldLeafIds(layout: TerminalLayoutSnapshot): string[] {
  return [...new Set(collectLeafIdsInOrder(layout.root))]
}

/** PTY ids this layout can actually reattach: bound to a leaf its own tree still mounts (#13098). */
function collectMountedPtyIds(layout: TerminalLayoutSnapshot): string[] {
  const leafIdsInTree = new Set(collectLeafIdsInOrder(layout.root))
  return [
    ...new Set(
      Object.entries(layout.ptyIdsByLeafId ?? {})
        .filter(([leafId]) => leafIdsInTree.has(leafId))
        .map(([, ptyId]) => ptyId)
    )
  ]
}

/**
 * Why an explicit map, even when it ends up empty: an absent one reads as a profile written
 * before leaf bindings existed, and reconnect hands such a row its own `ptyId` straight back.
 */
function withSurrenderedBindings(
  layout: TerminalLayoutSnapshot,
  ptyIdsByLeafId: Record<string, string>
): TerminalLayoutSnapshot {
  return {
    ...layout,
    ptyIdsByLeafId,
    activeLeafId: resolvePtyBoundActiveLeafId({
      root: layout.root,
      activeLeafId: layout.activeLeafId,
      ptyIdsByLeafId
    })
  }
}

function unbindLeafId(layout: TerminalLayoutSnapshot, leafId: string): TerminalLayoutSnapshot {
  const { [leafId]: _surrendered, ...ptyIdsByLeafId } = layout.ptyIdsByLeafId ?? {}
  return withSurrenderedBindings(layout, ptyIdsByLeafId)
}

function unbindPtyId(layout: TerminalLayoutSnapshot, ptyId: string): TerminalLayoutSnapshot {
  return withSurrenderedBindings(
    layout,
    Object.fromEntries(
      Object.entries(layout.ptyIdsByLeafId ?? {}).filter(([, bound]) => bound !== ptyId)
    )
  )
}

/**
 * A duplicated leaf id is an identity collision, so the losing pane leaves the tree entirely.
 * A single-leaf tree has nothing to detach into, and a tab with no pane at all is worse than
 * one that cold-starts a shell, so that loser only gives up the binding.
 */
function surrenderLeafId(layout: TerminalLayoutSnapshot, leafId: string): TerminalLayoutSnapshot {
  const detached = detachTerminalLayoutLeaf(layout, leafId)
  return detached
    ? withSurrenderedBindings(detached.sourceLayout, detached.sourceLayout.ptyIdsByLeafId ?? {})
    : unbindLeafId(layout, leafId)
}

/** One owner per duplicated key; every loser keeps its row, and nothing is deleted (#13060). */
function resolveDuplicateHolders(
  layoutsByTabId: Record<string, TerminalLayoutSnapshot>,
  ranking: TerminalLayoutOwnerRanking,
  readHeldKeys: (layout: TerminalLayoutSnapshot) => string[],
  surrender: (layout: TerminalLayoutSnapshot, key: string) => TerminalLayoutSnapshot
): Record<string, TerminalLayoutSnapshot> {
  const holderTabIdsByKey = new Map<string, string[]>()
  for (const [tabId, layout] of Object.entries(layoutsByTabId)) {
    for (const key of readHeldKeys(layout)) {
      const holders = holderTabIdsByKey.get(key)
      if (holders) {
        holders.push(tabId)
      } else {
        holderTabIdsByKey.set(key, [tabId])
      }
    }
  }
  let healed: Record<string, TerminalLayoutSnapshot> | null = null
  for (const [key, holderTabIds] of holderTabIdsByKey) {
    if (holderTabIds.length < 2) {
      continue
    }
    // Why sort over reduce: the id tie-break is deterministic only if every holder is compared.
    const [, ...losers] = [...holderTabIds].sort((a, b) => compareOwnerTabIds(a, b, ranking))
    healed ??= { ...layoutsByTabId }
    for (const tabId of losers) {
      healed[tabId] = surrender(healed[tabId]!, key)
    }
  }
  return healed ?? layoutsByTabId
}

/**
 * The hydration invariant: one leaf id belongs to one tab, and one PTY id is bound by one tab.
 * Leaf ids first, then PTY ids over the healed layouts, so a leaf the first pass surrendered is
 * not counted twice. Returns the argument itself when nothing collides (STA-7961).
 */
export function resolveDuplicateTerminalLayoutBindings(args: {
  canonicalTabIds: ReadonlySet<string>
  layoutsByTabId: Record<string, TerminalLayoutSnapshot>
  tabById: ReadonlyMap<string, TerminalTab>
}): Record<string, TerminalLayoutSnapshot> {
  const ranking = { canonicalTabIds: args.canonicalTabIds, tabById: args.tabById }
  return resolveDuplicateHolders(
    resolveDuplicateHolders(args.layoutsByTabId, ranking, collectHeldLeafIds, surrenderLeafId),
    ranking,
    collectMountedPtyIds,
    unbindPtyId
  )
}
