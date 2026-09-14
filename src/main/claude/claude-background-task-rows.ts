// One durable row per Claude background `task_id`, revised in place from the
// lifecycle frames so a failed command prints once with the provider sentence.

import { isSettledBackgroundTaskState } from '../../shared/native-chat-background-task-row'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import {
  classifyClaudeBackgroundTaskKind,
  record,
  taskDescription,
  taskId as readTaskId,
  taskName
} from './claude-background-task-frames'
import {
  claudeBackgroundTaskNotificationChange,
  claudeBackgroundTaskPatchChange,
  claudeBackgroundTaskToolUseId,
  isClaudeBackgroundTranscriptTask,
  newClaudeBackgroundTaskRow,
  newClaudeBackgroundTaskTerminalRow,
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
  /** Whether a tool id names a tool call this session forwarded at the TOP
   *  level. Consulted on first admission only: a task whose spawning tool never
   *  reached the transcript is a nested child, and a top-level row minted for it
   *  would claim an invocation the user never saw. */
  isForwardedParentTool: (toolUseId: string) => boolean
  now?: () => number
}

export class ClaudeBackgroundTaskRows {
  private readonly rows = new Map<string, ClaudeBackgroundTaskRow>()
  /** Runs seen per task id, so a reused id opens a new row instead of
   *  overwriting the finished one. Survives the row being evicted. */
  private readonly generations = new Map<string, number>()
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
    this.generations.clear()
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
      // A task that already exists and has not finished is not re-opened: a
      // duplicate announcement is a redelivery, not a second run, and treating
      // it as one would restate a row the user is already reading.
      if (!isSettledBackgroundTaskState(existing.block.state)) {
        return true
      }
      if (shouldRestartClaudeBackgroundTaskRow(existing, message)) {
        this.openRow(id, message, existing.generation + 1)
      } else {
        this.revise(id, claudeBackgroundTaskPatchChange(message))
      }
      return true
    }
    if (this.terminalTaskIds.has(id)) {
      return true
    }
    if (!this.admitsFirstRun(message)) {
      return true
    }
    if (!this.ensureRowSlot()) {
      return false
    }
    this.openRow(id, message, (this.generations.get(id) ?? 0) + 1)
    return true
  }

  /** The gate a task passes ONCE, when its first row is minted. Later frames
   *  for an admitted task are never re-gated: the decision belongs to the
   *  announcement, and re-asking it on a patch that carries no `tool_use_id`
   *  would drop the outcome of a task already on screen. */
  private admitsFirstRun(message: Record<string, unknown>): boolean {
    const toolUseId = claudeBackgroundTaskToolUseId(message)
    return toolUseId !== undefined && this.deps.isForwardedParentTool(toolUseId)
  }

  /** Admission for a row minted from terminal evidence alone. A frame that
   *  names no tool cannot be judged this way; see the deviation recorded in the
   *  PR for why such a frame is still allowed to report its failure. */
  private admitsTerminalOnly(message: Record<string, unknown>): boolean {
    const toolUseId = claudeBackgroundTaskToolUseId(message)
    return toolUseId === undefined || this.deps.isForwardedParentTool(toolUseId)
  }

  private openRow(id: string, message: Record<string, unknown>, generation: number): void {
    this.generations.set(id, generation)
    this.rows.set(id, newClaudeBackgroundTaskRow(id, message, this.now(), generation))
    this.write(id)
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
    // A terminal frame naming a tool this session never forwarded is a nested
    // child reporting into its own sidechain. It is refused here for the same
    // reason its announcement would have been: a top-level row for it claims an
    // invocation the user never saw.
    if (!this.admitsTerminalOnly(message)) {
      return true
    }
    // NAMED DEVIATION — a terminal frame naming NO tool still opens a row.
    //
    // The stricter rule would drop it. A real captured failure has this exact
    // shape: `{subtype:'task_notification', task_id:'bo2vuy8qb',
    // status:'failed', output_file:'', summary:"Check the verifier's state"}`,
    // with no `tool_use_id` to prove a forwarded parent. Dropping it reports
    // that failure NOWHERE: the strip unmounts once no live task remains, the
    // subagent roster excludes shell commands, and the status feed publishes
    // only live tasks.
    //
    // Whether such a frame can follow a `task_started` we simply refused is not
    // knowable from that capture: it records journal ROWS, and `task_started`
    // carries no failure so it never became one. See the PR for the full
    // measurement.
    if (!this.ensureRowSlot()) {
      return false
    }
    this.openTerminalRow(id, message)
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
      if (!this.admitsTerminalOnly(message)) {
        return true
      }
      if (!this.ensureRowSlot()) {
        return false
      }
      this.openTerminalRow(id, message)
      this.revise(id, change)
      return true
    }
    return change.error === undefined
  }

  /** A row minted straight from terminal evidence — see `observeNotification`. */
  private openTerminalRow(id: string, message: Record<string, unknown>): void {
    const generation = (this.generations.get(id) ?? 0) + 1
    this.generations.set(id, generation)
    this.rows.set(id, newClaudeBackgroundTaskTerminalRow(id, message, generation))
  }

  private observeAggregateRoster(value: unknown): void {
    if (!Array.isArray(value)) {
      return
    }
    for (const entry of value) {
      const task = record(entry)
      const id = task === null ? null : readTaskId(task)
      if (task === null || id === null || task.ambient === true || !this.rows.has(id)) {
        continue
      }
      // Membership is the ONLY liveness this payload carries: it is the whole
      // live set after a change, so presence means live and absence means
      // merely "no longer listed", never an outcome. Its per-entry status is
      // NOT read, because the payload has no such field — reading one derived a
      // state that was always undefined and left the reopen branch it guarded
      // unreachable on every real payload.
      //
      // Presence does not revive a settled row either. The payload is a level
      // signal whose ordering against the start/stop edges is unspecified, and
      // it carries no evidence of a NEW run — so a row that reported its own
      // outcome keeps it, and the task's own frames remain the only thing that
      // opens or settles one. Only the identity fields it really sends are read.
      this.revise(id, {
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
