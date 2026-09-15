import { isSettledBackgroundTaskState } from '../../shared/native-chat-background-task-row'
import type { ClaudeBackgroundTaskRow } from './claude-background-task-row-lifecycle'

export function rememberBoundedClaudeTaskSet(ids: Set<string>, id: string, maxSize: number): void {
  ids.delete(id)
  ids.add(id)
  while (ids.size > maxSize) {
    const oldest = ids.values().next()
    if (oldest.done || oldest.value === id) {
      break
    }
    ids.delete(oldest.value)
  }
}

export function rememberBoundedClaudeTaskMap<T>(
  entries: Map<string, T>,
  id: string,
  value: T,
  maxSize: number
): void {
  entries.delete(id)
  entries.set(id, value)
  while (entries.size > maxSize) {
    const oldest = entries.keys().next()
    if (oldest.done || oldest.value === id) {
      break
    }
    entries.delete(oldest.value)
  }
}

export function ensureClaudeBackgroundTaskRowSlot(
  rows: Map<string, ClaudeBackgroundTaskRow>,
  maxSize: number
): boolean {
  if (rows.size < maxSize) {
    return true
  }
  for (const [id, row] of rows) {
    if (isSettledBackgroundTaskState(row.block.state)) {
      rows.delete(id)
      return true
    }
  }
  return false
}

export function rememberClaudeBackgroundTaskTerminal(
  terminalIds: Set<string>,
  terminalToolUseIds: Map<string, string | undefined>,
  rows: Map<string, ClaudeBackgroundTaskRow>,
  id: string,
  toolUseId: string | undefined,
  maxSize: number
): void {
  terminalIds.delete(id)
  terminalIds.add(id)
  terminalToolUseIds.set(id, toolUseId ?? rows.get(id)?.toolUseId ?? terminalToolUseIds.get(id))
  while (terminalIds.size > maxSize) {
    const oldest = terminalIds.values().next()
    if (oldest.done || oldest.value === id) {
      break
    }
    terminalToolUseIds.delete(oldest.value)
    terminalIds.delete(oldest.value)
  }
}
