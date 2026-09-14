// Hides the synthetic status rows an older build wrote when restart eviction settled a
// resumable session. Their copy was a bare `Provider exited: <reason>` the user could not act on.
//
// Those rows are durable history, so they cannot be un-written without a data migration that
// would fork the journal schema. They are filtered out of the render projection instead.
//
// The `restart-eviction:` identity is still minted today, so identity alone would be too wide a
// net: the retired copy prefix is what confines this to legacy rows. A genuine provider death
// settled under that identity carries the current outcome copy and still renders.

import { parseAgentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'

const RETIRED_RESTART_EVICTION_TEXT_PREFIX = 'Provider exited'

export function isRestartEvictionStatusItem(
  item: AgentJournalRenderItem,
  sessionId: string
): boolean {
  if (item.body.kind !== 'status') {
    return false
  }
  if (!item.body.text.startsWith(RETIRED_RESTART_EVICTION_TEXT_PREFIX)) {
    return false
  }
  const identity = parseAgentJournalItemKey(item.itemId)
  if (identity?.provider !== 'orca') {
    return false
  }
  const prefix = `restart-eviction:${sessionId}:`
  if (!identity.clientMessageId.startsWith(prefix)) {
    return false
  }
  const rawFence = identity.clientMessageId.slice(prefix.length)
  const fence = Number(rawFence)
  return Number.isSafeInteger(fence) && fence > 0 && String(fence) === rawFence
}

export function withoutRestartEvictionStatusItems(
  items: readonly AgentJournalRenderItem[],
  sessionId: string
): AgentJournalRenderItem[] {
  return items.filter((item) => !isRestartEvictionStatusItem(item, sessionId))
}
