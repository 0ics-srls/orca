// Hides the synthetic status rows an older build wrote when restart eviction settled a
// resumable session.
//
// Those rows are durable history, so they cannot be un-written without a data migration that
// would fork the journal schema. They are filtered out of the render projection instead: the
// identity is exact enough that nothing else can match it, and no writer produces it any more.

import { parseAgentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'

export function isRestartEvictionStatusItem(
  item: AgentJournalRenderItem,
  sessionId: string
): boolean {
  if (item.body.kind !== 'status') {
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
