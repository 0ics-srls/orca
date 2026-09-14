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
  /** Which RUN of this task id the row records. 1 for the first. */
  generation: number
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
  now: number,
  generation: number
): ClaudeBackgroundTaskRow {
  const totalTokens = taskUsageTotalTokens(message)
  const toolUseId = claudeBackgroundTaskToolUseId(message)
  return {
    lastSerialized: null,
    generation,
    ...(toolUseId === undefined ? {} : { toolUseId }),
    block: {
      type: 'background-task',
      taskId: id,
      kind: classifyClaudeBackgroundTaskKind(message.task_type),
      label: taskDescription(message.description) ?? taskName(message) ?? '',
      ...(toolUseId === undefined ? {} : { parentToolUseId: toolUseId }),
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
  message: Record<string, unknown>,
  generation: number
): ClaudeBackgroundTaskRow {
  const patch = record(message.patch)
  const source = patch ?? message
  const toolUseId = claudeBackgroundTaskToolUseId(message)
  return {
    lastSerialized: null,
    generation,
    ...(toolUseId === undefined ? {} : { toolUseId }),
    block: {
      type: 'background-task',
      taskId: id,
      kind: 'task_type' in source ? classifyClaudeBackgroundTaskKind(source.task_type) : 'unknown',
      label: taskDescription(source.description) ?? taskName(source) ?? '',
      ...(toolUseId === undefined ? {} : { parentToolUseId: toolUseId }),
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
      ...((toolUseId ?? row.block.parentToolUseId)
        ? { parentToolUseId: toolUseId ?? row.block.parentToolUseId }
        : {}),
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

/** Task types the transcript materializes as a row.
 *
 *  Type is the whole gate. A MONITOR is never admitted: it is Claude's own
 *  ambient housekeeping, runs for the life of the session, and has no outcome a
 *  transcript row could report. A type this build does not recognise is not
 *  evidence of anything a row could truthfully say either. Agents are
 *  materialized too, by the subagent roster, which claims them upstream of this
 *  owner — so the set left here is the backgrounded shell command and the
 *  workflow. */
const MATERIALIZED_TASK_KINDS: ReadonlySet<NativeChatBackgroundTaskBlock['kind']> = new Set([
  'command',
  'workflow'
])

export function isClaudeBackgroundTranscriptTask(
  message: Record<string, unknown>,
  kind: NativeChatBackgroundTaskBlock['kind']
): boolean {
  // A task the provider explicitly calls foreground is the turn's own work and
  // already has the tool row that invoked it.
  return MATERIALIZED_TASK_KINDS.has(kind) && message.is_backgrounded !== false
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
