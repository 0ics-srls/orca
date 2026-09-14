// One durable row per Claude background `task_id`, revised in place from the
// lifecycle frames so a failed command prints once with the provider sentence.

import { isSettledBackgroundTaskState } from '../../shared/native-chat-background-task-row'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import {
  classifyClaudeBackgroundTaskKind,
  liveClaudeTaskRunState,
  record,
  taskDescription,
  taskId as readTaskId,
  taskName,
  terminalClaudeTaskRunState
} from './claude-background-task-frames'
import {
  canReopenClaudeBackgroundTaskRowFromAggregate,
  claudeBackgroundTaskNotificationChange,
  claudeBackgroundTaskPatchChange,
  claudeBackgroundTaskToolUseId,
  isClaudeBackgroundTranscriptTask,
  newClaudeBackgroundTaskRow,
  newClaudeBackgroundTaskTerminalRow,
  reopenClaudeBackgroundTaskRow,
  reviseClaudeBackgroundTaskRow,
  shouldRestartClaudeBackgroundTaskRow,
  type ClaudeBackgroundTaskChange,
  type ClaudeBackgroundTaskRow
} from './claude-background-task-row-lifecycle'
import { writeClaudeBackgroundTaskRow } from './claude-background-task-row-journal'
import { ClaudeSubagentIds } from './claude-subagent-id-aliases'
import { isClaudeSubagentTask } from './claude-subagent-task-frames'

const MAX_TASK_ROWS = 64
const MAX_FOREIGN_TASK_ROWS = 512
const MAX_TERMINAL_TASK_IDS = 512

const TASK_SUBTYPES: ReadonlySet<string> = new Set([
  'task_started',
  'task_updated',
  'task_progress',
  'task_notification'
])

type ForeignOwner = 'roster' | 'ambient' | 'foreground'

export type ClaudeBackgroundTaskRowsDeps = {
  sink: StructuredAgentSessionEventSink
  now?: () => number
}

export class ClaudeBackgroundTaskRows {
  private readonly rows = new Map<string, ClaudeBackgroundTaskRow>()
  private readonly foreign = new Map<string, ForeignOwner>()
  private readonly terminalTaskIds = new Set<string>()
  private readonly ids = new ClaudeSubagentIds()
  private readonly now: () => number

  constructor(private readonly deps: ClaudeBackgroundTaskRowsDeps) {
    this.now = deps.now ?? (() => Date.now())
  }

  observe(message: Record<string, unknown>): boolean {
    if (message.type !== 'system') {
      return false
    }
    if (message.subtype === 'background_tasks_changed') {
      if (!Array.isArray(message.tasks)) {
        return false
      }
      this.observeAggregateRoster(message.tasks)
      return true
    }
    if (typeof message.subtype !== 'string' || !TASK_SUBTYPES.has(message.subtype)) {
      return false
    }
    const id = this.canonicalId(message)
    if (id === null) {
      return false
    }
    if (message.subtype === 'task_started') {
      return this.observeStart(id, message)
    }
    if (this.foreign.has(id)) {
      return true
    }
    if (message.subtype === 'task_notification') {
      return this.observeNotification(id, message)
    }
    return this.observePatch(id, message)
  }

  settleSession(): void {
    for (const [id, row] of this.rows) {
      if (!isSettledBackgroundTaskState(row.block.state)) {
        this.revise(id, { state: 'unverifiable' })
      }
    }
  }

  dispose(): void {
    this.settleSession()
    this.rows.clear()
    this.foreign.clear()
    this.terminalTaskIds.clear()
    this.ids.clear()
  }

  private canonicalId(message: Record<string, unknown>): string | null {
    const declared = readTaskId(message)
    const toolUseId = claudeBackgroundTaskToolUseId(message)
    if (declared === null) {
      const aliased = toolUseId === undefined ? null : this.ids.canonical(toolUseId)
      return aliased !== null && aliased !== toolUseId ? aliased : null
    }
    if (toolUseId !== undefined) {
      this.ids.alias(toolUseId, declared)
    }
    return declared
  }

  private observeStart(id: string, message: Record<string, unknown>): boolean {
    if (message.ambient === true || message.skip_transcript === true) {
      this.rememberForeign(id, 'ambient')
      return true
    }
    if (isClaudeSubagentTask(message)) {
      this.rememberForeign(id, 'roster')
      return true
    }
    const kind = classifyClaudeBackgroundTaskKind(message.task_type)
    if (!isClaudeBackgroundTranscriptTask(message, kind)) {
      this.rememberForeign(id, 'foreground')
      return true
    }
    this.foreign.delete(id)
    const existing = this.rows.get(id)
    if (existing) {
      if (shouldRestartClaudeBackgroundTaskRow(existing, message)) {
        this.rows.set(id, newClaudeBackgroundTaskRow(id, message, this.now()))
        this.write(id)
      } else {
        this.revise(id, claudeBackgroundTaskPatchChange(message))
      }
      return true
    }
    if (this.terminalTaskIds.has(id)) {
      return true
    }
    if (!this.ensureRowSlot()) {
      return false
    }
    this.rows.set(id, newClaudeBackgroundTaskRow(id, message, this.now()))
    this.write(id)
    return true
  }

  private observeNotification(id: string, message: Record<string, unknown>): boolean {
    const change = claudeBackgroundTaskNotificationChange(message)
    const state = change.state ?? 'done'
    this.rememberTerminalId(id)
    if (this.rows.has(id)) {
      this.revise(id, change)
      return true
    }
    if (state === 'done' && change.error === undefined) {
      return true
    }
    if (!this.ensureRowSlot()) {
      return false
    }
    this.rows.set(id, {
      ...newClaudeBackgroundTaskTerminalRow(id, message)
    })
    this.revise(id, change)
    return true
  }

  private observePatch(id: string, message: Record<string, unknown>): boolean {
    const patch = record(message.patch)
    if (patch?.is_backgrounded === false) {
      this.rememberForeign(id, 'foreground')
      return true
    }
    const change = claudeBackgroundTaskPatchChange(message)
    if (this.rows.has(id)) {
      this.revise(id, change)
      return true
    }
    if (change.state && isSettledBackgroundTaskState(change.state)) {
      this.rememberTerminalId(id)
      if (change.state === 'done' && change.error === undefined) {
        return true
      }
      if (!this.ensureRowSlot()) {
        return false
      }
      this.rows.set(id, newClaudeBackgroundTaskTerminalRow(id, message))
      this.revise(id, change)
      return true
    }
    return change.error === undefined
  }

  private observeAggregateRoster(value: unknown): void {
    if (!Array.isArray(value)) {
      return
    }
    for (const entry of value) {
      const task = record(entry)
      const id = task === null ? null : readTaskId(task)
      if (task === null || id === null || !this.rows.has(id)) {
        continue
      }
      const state = terminalClaudeTaskRunState(task.status) ?? liveClaudeTaskRunState(task.status)
      const row = this.rows.get(id)
      if (row && canReopenClaudeBackgroundTaskRowFromAggregate(row, state)) {
        this.rows.set(id, reopenClaudeBackgroundTaskRow(row, id, task, state, this.now()))
        this.write(id)
        continue
      }
      this.revise(id, {
        state,
        label: taskDescription(task.description) ?? taskName(task),
        kind:
          task.task_type === undefined
            ? undefined
            : classifyClaudeBackgroundTaskKind(task.task_type)
      })
    }
  }

  private revise(id: string, change: ClaudeBackgroundTaskChange): void {
    const row = this.rows.get(id)
    if (!row) {
      return
    }
    reviseClaudeBackgroundTaskRow(row, change, this.now())
    this.write(id)
  }

  private ensureRowSlot(): boolean {
    if (this.rows.size < MAX_TASK_ROWS) {
      return true
    }
    for (const [id, row] of this.rows) {
      if (isSettledBackgroundTaskState(row.block.state)) {
        this.rows.delete(id)
        return true
      }
    }
    return false
  }

  private rememberForeign(id: string, owner: ForeignOwner): void {
    if (this.foreign.has(id)) {
      this.foreign.delete(id)
    }
    this.foreign.set(id, owner)
    while (this.foreign.size > MAX_FOREIGN_TASK_ROWS) {
      const oldest = this.foreign.keys().next()
      if (oldest.done || oldest.value === id) {
        break
      }
      this.foreign.delete(oldest.value)
    }
  }

  private rememberTerminalId(id: string): void {
    if (this.terminalTaskIds.has(id)) {
      this.terminalTaskIds.delete(id)
    }
    this.terminalTaskIds.add(id)
    while (this.terminalTaskIds.size > MAX_TERMINAL_TASK_IDS) {
      const oldest = this.terminalTaskIds.values().next()
      if (oldest.done || oldest.value === id) {
        break
      }
      this.terminalTaskIds.delete(oldest.value)
    }
  }

  private write(id: string): void {
    const row = this.rows.get(id)
    if (!row) {
      return
    }
    writeClaudeBackgroundTaskRow(this.deps.sink, id, row)
  }
}
