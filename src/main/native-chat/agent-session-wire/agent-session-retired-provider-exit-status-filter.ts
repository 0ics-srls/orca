// Hides the synthetic status rows an older build wrote when restart eviction settled a
// resumable session. Their copy was a bare `Provider exited: <reason>` the user could not act on.
//
// Those rows are durable history, so they cannot be un-written without a data migration that
// would fork the journal schema. They are filtered out of the render projection instead.
//
// SCOPE. This retires ONE copy, not an identity. The `restart-eviction:` id is still minted
// today, so identity alone would be too wide a net: a genuine provider death settled under that
// identity carries the current outcome copy and still renders. The retired-copy prefix is what
// confines this to legacy rows.

import { parseAgentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'

const RETIRED_PROVIDER_EXIT_TEXT_PREFIX = 'Provider exited'

function isRetiredProviderExitStatusItem(item: AgentJournalRenderItem, sessionId: string): boolean {
  if (item.body.kind !== 'status') {
    return false
  }
  if (!item.body.text.startsWith(RETIRED_PROVIDER_EXIT_TEXT_PREFIX)) {
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

/** The ONE place a raw item array becomes renderable. Callers apply it where items ENTER the page
 *  pipeline, never on the way out: a window bound, a `hasOlder` or a cursor computed over the
 *  unfiltered array and then handed a filtered one disagree, and a page that is empty only because
 *  of this filter while still claiming older history wedges the reader that pages on it. */
export function withoutRetiredProviderExitStatusItems(
  items: readonly AgentJournalRenderItem[],
  sessionId: string
): AgentJournalRenderItem[] {
  return items.filter((item) => !isRetiredProviderExitStatusItem(item, sessionId))
}
