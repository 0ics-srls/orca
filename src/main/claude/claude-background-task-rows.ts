// The durable transcript row one Claude background task writes.
//
// Claude announces every task — subagent, workflow, monitor, backgrounded shell
// — on one `message:system:task_*` channel. The subagent roster claims the
// agents and excludes the rest, which left the rest with no typed row at all:
// their frames were catalogued as chrome, and the generic payload sniffer then
// promoted the failed ones to a red row whose visible text was the wire opcode.
//
// Suppressing those frames instead is not an option, and that is measured, not
// assumed: when the last background task settles, the tracker flushes it and
// the strip unmounts, `local_bash` is excluded from the roster, and the status
// feed publishes live tasks only. For a lone backgrounded command, this row is
// the ONLY place its failure is ever reported.
//
// So one row per `task_id`, opened by the announcement, revised in place by the
// lifecycle frames, closed by the notification — never one row per frame, which
// is what printed a single failure twice.

import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity
} from '../../shared/agent-session-journal-types'
import {
  backgroundTaskFallbackText,
  canReplaceBackgroundTaskState,
  isSettledBackgroundTaskState
} from '../../shared/native-chat-background-task-row'
import type { NativeChatBackgroundTaskBlock } from '../../shared/native-chat-types'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import {
  classifyClaudeBackgroundTaskKind,
  isBoundedClaudeTaskId,
  liveClaudeTaskRunState,
  record,
  taskDescription,
  taskId as readTaskId,
  taskName,
  taskText,
  taskUsageTotalTokens,
  terminalClaudeTaskRunState
} from './claude-background-task-frames'
import { ClaudeSubagentIds } from './claude-subagent-id-aliases'
import { isClaudeSubagentTask } from './claude-subagent-task-frames'

/** Rows kept per session. Bounds an event-accumulated map no provider snapshot
 *  prunes; a session running more concurrent background tasks than this gets no
 *  row for the overflow rather than an unbounded journal. */
const MAX_TASK_ROWS = 64

const TASK_SUBTYPES: ReadonlySet<string> = new Set([
  'task_started',
  'task_updated',
  'task_progress',
  'task_notification'
])

/** Who owns an id this module is not writing a row for. */
type ForeignOwner =
  /** The subagent roster announced it as an agent and renders it already. */
  | 'roster'
  /** Housekeeping Claude runs for itself; the user never asked for it. */
  | 'ambient'

type TaskRow = { block: NativeChatBackgroundTaskBlock; lastSerialized: string | null }

/** Durable journal identity for a task's row — stable across revisions and
 *  across a restart, so replay finds the same row instead of appending one. */
export function claudeBackgroundTaskIdentity(taskId: string): AgentJournalItemIdentity {
  return { provider: 'orca', clientMessageId: `claude-background-task:${taskId}` }
}

/** The row: the structured block plus the plain sentence a client without the
 *  block type renders in its place. A message whose only block is the new
 *  variant would reach such a client with nothing it can draw, and a new item
 *  KIND would reach it as nothing at all. */
export function claudeBackgroundTaskBody(
  block: NativeChatBackgroundTaskBlock
): AgentJournalItemBody {
  return {
    kind: 'message',
    role: 'system',
    blocks: [{ type: 'text', text: backgroundTaskFallbackText(block) }, { ...block }]
  }
}

export type ClaudeBackgroundTaskRowsDeps = {
  sink: StructuredAgentSessionEventSink
  now?: () => number
}

export class ClaudeBackgroundTaskRows {
  private readonly rows = new Map<string, TaskRow>()
  private readonly foreign = new Map<string, ForeignOwner>()
  private readonly ids = new ClaudeSubagentIds()
  private readonly now: () => number

  constructor(private readonly deps: ClaudeBackgroundTaskRowsDeps) {
    this.now = deps.now ?? (() => Date.now())
  }

  /** Consume a background-task lifecycle frame. Returns false when it is not
   *  one. A `true` return means this module owns the frame, INCLUDING when it
   *  deliberately writes nothing for it. */
  observe(message: Record<string, unknown>): boolean {
    if (message.type !== 'system') {
      return false
    }
    if (message.subtype === 'background_tasks_changed') {
      this.observeAggregateRoster(message.tasks)
      return true
    }
    if (typeof message.subtype !== 'string' || !TASK_SUBTYPES.has(message.subtype)) {
      return false
    }
    const id = this.canonicalId(message)
    if (id === null) {
      return true
    }
    if (message.subtype === 'task_started') {
      this.observeStart(id, message)
      return true
    }
    if (this.foreign.has(id)) {
      return true
    }
    if (message.subtype === 'task_notification') {
      this.observeNotification(id, message)
      return true
    }
    // `task_updated` and `task_progress` are patches, not announcements: neither
    // carries a `task_type`, so honouring one for an id nothing declared would
    // row whatever else shares this channel. They revise, never create.
    this.revise(id, this.patchChange(message))
    return true
  }

  /** Nothing more will arrive for any task, so every live row loses contact.
   *  That is not evidence it exited (docs/reference/ssh-execution-boundary.md). */
  settleSession(): void {
    for (const [id, row] of this.rows) {
      if (!isSettledBackgroundTaskState(row.block.state)) {
        this.revise(id, { state: 'unverifiable' })
      }
    }
  }

  dispose(): void {
    // Teardown reaches here without an `ended` event, so a row still reporting
    // live work would have nothing left to revise it.
    this.settleSession()
    this.rows.clear()
    this.foreign.clear()
    this.ids.clear()
  }

  /** The task id a frame names, with its tool id recorded as an alias: Claude
   *  re-announces a resumed task under a NEW `tool_use_id` while `task_id`
   *  stays put, so keying on the tool id would show the task twice. */
  private canonicalId(message: Record<string, unknown>): string | null {
    const patch = record(message.patch)
    const declared = readTaskId(message)
    const toolUseId = taskText(message.tool_use_id) ?? taskText(patch?.tool_use_id)
    if (declared === null) {
      const aliased = toolUseId === undefined ? null : this.ids.canonical(toolUseId)
      return aliased !== null && aliased !== toolUseId ? aliased : null
    }
    if (toolUseId !== undefined && isBoundedClaudeTaskId(toolUseId)) {
      this.ids.alias(toolUseId, declared)
    }
    return declared
  }

  private observeStart(id: string, message: Record<string, unknown>): void {
    if (message.ambient === true || message.skip_transcript === true) {
      this.foreign.set(id, 'ambient')
      return
    }
    if (isClaudeSubagentTask(message)) {
      this.foreign.set(id, 'roster')
      return
    }
    this.foreign.delete(id)
    const existing = this.rows.get(id)
    if (existing) {
      this.revise(id, this.patchChange(message))
      return
    }
    if (this.rows.size >= MAX_TASK_ROWS) {
      return
    }
    const now = this.now()
    this.rows.set(id, {
      lastSerialized: null,
      block: {
        type: 'background-task',
        taskId: id,
        kind: classifyClaudeBackgroundTaskKind(message.task_type),
        label: taskDescription(message.description) ?? taskName(message) ?? '',
        state: liveClaudeTaskRunState(message.status) ?? 'working',
        startedAt: now,
        ...(taskUsageTotalTokens(message) === undefined
          ? {}
          : { tokens: taskUsageTotalTokens(message) })
      }
    })
    this.write(id)
  }

  private observeNotification(id: string, message: Record<string, unknown>): void {
    // The notification is affirmative terminal evidence even when its status is
    // unreadable, matching the liveness semantics this channel always had.
    const state = terminalClaudeTaskRunState(message.status) ?? 'done'
    const change: TaskChange = {
      state,
      summary: taskText(message.summary),
      error: taskText(message.error),
      outputFile: taskText(message.output_file),
      tokens: taskUsageTotalTokens(message)
    }
    if (this.rows.has(id)) {
      this.revise(id, change)
      return
    }
    // The first and last frame for a task this session never saw start — a
    // resumed session, or an announcement that predates the journal. A failure
    // here is the only report the user will ever get, so it opens a row of its
    // own; a silent success is not worth one nobody asked for.
    if (state === 'done' && change.error === undefined) {
      return
    }
    if (this.rows.size >= MAX_TASK_ROWS) {
      return
    }
    this.rows.set(id, {
      lastSerialized: null,
      block: {
        type: 'background-task',
        taskId: id,
        kind: 'unknown',
        label: taskDescription(message.description) ?? taskName(message) ?? '',
        state: 'working'
      }
    })
    this.revise(id, change)
  }

  /** A `task_updated` patch or a `task_progress` tick, read as a row change.
   *  `task_progress` carries the CURRENT ACTIVITY in `description`, not the
   *  task's name, so only a row still missing a label takes one from it. */
  private patchChange(message: Record<string, unknown>): TaskChange {
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

  /** The aggregate roster enumerates BACKGROUND work only, so it is
   *  authoritative over the tasks it lists and silent about everything else. A
   *  task missing from it is not thereby finished — only its own terminal frame
   *  says that — so this revises listed rows and creates none. */
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
      this.revise(id, {
        state: terminalClaudeTaskRunState(task.status) ?? liveClaudeTaskRunState(task.status),
        label: taskDescription(task.description) ?? taskName(task),
        kind:
          task.task_type === undefined
            ? undefined
            : classifyClaudeBackgroundTaskKind(task.task_type)
      })
    }
  }

  private revise(id: string, change: TaskChange): void {
    const row = this.rows.get(id)
    if (!row) {
      return
    }
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
    // Proven outcomes latch; lost contact can still receive a later verdict.
    if (change.state && canReplaceBackgroundTaskState(next.state, change.state)) {
      next.state = change.state
      if (isSettledBackgroundTaskState(change.state)) {
        next.settledAt = this.now()
      }
    }
    row.block = next
    this.write(id)
  }

  private write(id: string): void {
    const row = this.rows.get(id)
    if (!row) {
      return
    }
    const body = claudeBackgroundTaskBody(row.block)
    const serialized = JSON.stringify(body)
    if (serialized === row.lastSerialized) {
      // Nothing changed — a duplicate delivery must not burn a revision.
      return
    }
    row.lastSerialized = serialized
    this.deps.sink.appendItem(claudeBackgroundTaskIdentity(id), body, {
      coalescingKey: `claude-background-task:${id}`
    })
    // Publish keeps the sink's own coalescing slot: sharing the row's key makes
    // each queued publish evict the append it was meant to flush.
    this.deps.sink.publish()
  }
}

type TaskChange = {
  state?: NativeChatBackgroundTaskBlock['state'] | null
  label?: string | undefined
  kind?: NativeChatBackgroundTaskBlock['kind'] | undefined
  summary?: string | undefined
  error?: string | undefined
  outputFile?: string | undefined
  tokens?: number | undefined
}
