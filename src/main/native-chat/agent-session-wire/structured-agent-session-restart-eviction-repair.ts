import { parseAgentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type {
  AgentJournalItemIdentity,
  AgentJournalRenderItem
} from '../../../shared/agent-session-journal-types'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'

export const RESTART_EVICTION_STATUS_MIGRATION_ID = 'restart-eviction-status-v1'

export async function repairSyntheticRestartEvictionSettlements(input: {
  journal: Pick<AgentSessionJournal, 'applyEpochTombstoneMigration'>
  sessionId: string
  fence: number
}): Promise<number> {
  const migrated = await input.journal.applyEpochTombstoneMigration({
    migrationId: RESTART_EVICTION_STATUS_MIGRATION_ID,
    settlementId: `restart-eviction-repair:${RESTART_EVICTION_STATUS_MIGRATION_ID}`,
    fence: input.fence,
    recovered: true,
    selectIdentity: (item) => syntheticRestartEvictionIdentity(item, input.sessionId)
  })
  return migrated.tombstonedItems
}

function syntheticRestartEvictionIdentity(
  item: AgentJournalRenderItem,
  sessionId: string
): Extract<AgentJournalItemIdentity, { provider: 'orca' }> | null {
  if (item.body.kind !== 'status') {
    return null
  }
  const identity = parseAgentJournalItemKey(item.itemId)
  if (identity?.provider !== 'orca') {
    return null
  }
  const prefix = `restart-eviction:${sessionId}:`
  if (!identity.clientMessageId.startsWith(prefix)) {
    return null
  }
  const rawFence = identity.clientMessageId.slice(prefix.length)
  const fence = Number(rawFence)
  return Number.isSafeInteger(fence) && fence > 0 && String(fence) === rawFence ? identity : null
}
