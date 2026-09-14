import {
  canReplaceBackgroundTaskState,
  isSettledBackgroundTaskState
} from '../../shared/native-chat-background-task-row'
import type { NativeChatBackgroundTaskBlock } from '../../shared/native-chat-types'
import {
  classifyClaudeBackgroundTaskKind,
  liveClaudeTaskRunState,
  record,
  taskAliasId,
  taskDescription,
  taskName,
  taskText,
  taskUsageTotalTokens,
  terminalClaudeTaskRunState
} from './claude-background-task-frames'

export type ClaudeBackgroundTaskRow = {
  block: NativeChatBackgroundTaskBlock
  lastSerialized: string | null
  toolUseId?: string
}

export type ClaudeBackgroundTaskChange = {
  state?: NativeChatBackgroundTaskBlock['state'] | null
  label?: string | undefined
  kind?: NativeChatBackgroundTaskBlock['kind'] | undefined
  summary?: string | undefined
  error?: string | undefined
  outputFile?: string | undefined
  tokens?: number | undefined
}

export function claudeBackgroundTaskToolUseId(
  message: Record<string, unknown>
): string | undefined {
  const patch = record(message.patch)
  return taskAliasId(message.tool_use_id) ?? taskAliasId(patch?.tool_use_id)
}

export function claudeBackgroundTaskNotificationChange(
  message: Record<string, unknown>
): ClaudeBackgroundTaskChange {
  return {
    state: terminalClaudeTaskRunState(message.status) ?? 'done',
    summary: taskText(message.summary),
    error: taskText(message.error),
    outputFile: taskText(message.output_file),
    tokens: taskUsageTotalTokens(message)
  }
}

export function claudeBackgroundTaskPatchChange(
  message: Record<string, unknown>
): ClaudeBackgroundTaskChange {
  const patch = record(message.patch) ?? message
  const status = patch.status ?? message.status
  const terminal = terminalClaudeTaskRunState(status)
  return {
    state: terminal ?? liveClaudeTaskRunState(status),
    label:
      message.subtype === 'task_progress'
        ? undefined
        : (taskDescription(patch.description) ?? taskName(patch)),
    kind: 'task_type' in patch ? classifyClaudeBackgroundTaskKind(patch.task_type) : undefined,
    error: taskText(patch.error),
    tokens: taskUsageTotalTokens(message)
  }
}

export function newClaudeBackgroundTaskRow(
  id: string,
  message: Record<string, unknown>,
  now: number
): ClaudeBackgroundTaskRow {
  const totalTokens = taskUsageTotalTokens(message)
  const toolUseId = claudeBackgroundTaskToolUseId(message)
  return {
    lastSerialized: null,
    ...(toolUseId === undefined ? {} : { toolUseId }),
    block: {
      type: 'background-task',
      taskId: id,
      kind: classifyClaudeBackgroundTaskKind(message.task_type),
      label: taskDescription(message.description) ?? taskName(message) ?? '',
      state:
        terminalClaudeTaskRunState(message.status) ??
        liveClaudeTaskRunState(message.status) ??
        'working',
      startedAt: now,
      ...(totalTokens === undefined ? {} : { tokens: totalTokens })
    }
  }
}

export function newClaudeBackgroundTaskTerminalRow(
  id: string,
  message: Record<string, unknown>
): ClaudeBackgroundTaskRow {
  const patch = record(message.patch)
  const source = patch ?? message
  const toolUseId = claudeBackgroundTaskToolUseId(message)
  return {
    lastSerialized: null,
    ...(toolUseId === undefined ? {} : { toolUseId }),
    block: {
      type: 'background-task',
      taskId: id,
      kind: 'task_type' in source ? classifyClaudeBackgroundTaskKind(source.task_type) : 'unknown',
      label: taskDescription(source.description) ?? taskName(source) ?? '',
      state: 'working'
    }
  }
}

export function reopenClaudeBackgroundTaskRow(
  row: ClaudeBackgroundTaskRow,
  id: string,
  message: Record<string, unknown>,
  state: NativeChatBackgroundTaskBlock['state'],
  now: number
): ClaudeBackgroundTaskRow {
  const kind =
    'task_type' in message ? classifyClaudeBackgroundTaskKind(message.task_type) : row.block.kind
  const totalTokens = taskUsageTotalTokens(message)
  const toolUseId = claudeBackgroundTaskToolUseId(message)
  return {
    ...row,
    ...(toolUseId === undefined ? {} : { toolUseId }),
    block: {
      type: 'background-task',
      taskId: id,
      kind: kind === 'unknown' ? row.block.kind : kind,
      label: taskDescription(message.description) ?? taskName(message) ?? row.block.label,
      state,
      startedAt: now,
      ...(totalTokens === undefined ? {} : { tokens: totalTokens })
    }
  }
}

export function shouldRestartClaudeBackgroundTaskRow(
  row: ClaudeBackgroundTaskRow,
  message: Record<string, unknown>
): boolean {
  if (!isSettledBackgroundTaskState(row.block.state) || row.block.startedAt === undefined) {
    return false
  }
  const toolUseId = claudeBackgroundTaskToolUseId(message)
  return toolUseId !== undefined && toolUseId !== row.toolUseId
}

export function canReopenClaudeBackgroundTaskRowFromAggregate(
  row: ClaudeBackgroundTaskRow,
  state: NativeChatBackgroundTaskBlock['state'] | null
): state is NativeChatBackgroundTaskBlock['state'] {
  return (
    state !== null &&
    !isSettledBackgroundTaskState(state) &&
    isSettledBackgroundTaskState(row.block.state) &&
    row.block.state !== 'blocked'
  )
}

export function isClaudeBackgroundTranscriptTask(
  message: Record<string, unknown>,
  kind: NativeChatBackgroundTaskBlock['kind']
): boolean {
  return message.is_backgrounded === true || kind === 'workflow' || kind === 'monitor'
}

export function reviseClaudeBackgroundTaskRow(
  row: ClaudeBackgroundTaskRow,
  change: ClaudeBackgroundTaskChange,
  now: number
): void {
  const next: NativeChatBackgroundTaskBlock = { ...row.block }
  if (change.label && !next.label) {
    next.label = change.label
  }
  if (change.kind !== undefined && change.kind !== 'unknown') {
    next.kind = change.kind
  }
  if (change.summary !== undefined) {
    next.summary = change.summary
  }
  if (change.error !== undefined) {
    next.error = change.error
  }
  if (change.outputFile !== undefined) {
    next.outputFile = change.outputFile
  }
  if (change.tokens !== undefined) {
    next.tokens = change.tokens
  }
  if (change.state && canReplaceBackgroundTaskState(next.state, change.state)) {
    next.state = change.state
    if (isSettledBackgroundTaskState(change.state)) {
      next.settledAt = now
    }
  }
  row.block = next
}
