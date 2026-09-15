import { normalizeProviderTurnIdentity } from './provider-turn-identity'
import type {
  ProviderCurrentTurnInventory,
  ProviderTurnInventoryWork,
  ProviderWorkKind
} from './provider-turn-evidence-types'

const MAX_WORK_IDS = 128

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function providerCurrentTurnInventory(
  value: unknown,
  complete: unknown
): ProviderCurrentTurnInventory | null {
  if (complete !== true || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  if (!isRecord(value)) {
    return null
  }
  const record = value
  const turnId = normalizeProviderTurnIdentity(record.turnId ?? record.turn_id ?? record.id)
  if (!turnId) {
    return null
  }
  const readWork = (
    candidate: unknown,
    kind: ProviderWorkKind
  ): ProviderTurnInventoryWork[] | null => {
    if (!Array.isArray(candidate) || candidate.length > MAX_WORK_IDS) {
      return null
    }
    const result: ProviderTurnInventoryWork[] = []
    for (const item of candidate) {
      if (!isRecord(item)) {
        return null
      }
      const workId = normalizeProviderTurnIdentity(item.workId ?? item.work_id ?? item.id)
      const phase =
        item.phase === 'active' || item.phase === 'settled' || item.phase === 'unresolved'
          ? item.phase
          : null
      if (!workId || !phase) {
        return null
      }
      const outcome =
        item.outcome === 'completed' || item.outcome === 'failed' || item.outcome === 'interrupted'
          ? item.outcome
          : undefined
      result.push({
        workId,
        kind,
        phase,
        ...(outcome ? { outcome } : {}),
        ...(typeof item.startedAt === 'number' ? { startedAt: item.startedAt } : {}),
        ...(typeof item.settledAt === 'number' ? { settledAt: item.settledAt } : {})
      })
    }
    return result
  }
  const joinedChildren = readWork(record.joinedChildren ?? record.joined_children, 'joined-child')
  const residentBackground = readWork(
    record.residentBackground ?? record.resident_background,
    'resident-background'
  )
  if (joinedChildren === null || residentBackground === null) {
    return null
  }
  return {
    turnId,
    ...(typeof record.startedAt === 'number' ? { startedAt: record.startedAt } : {}),
    joinedChildren,
    residentBackground
  }
}
