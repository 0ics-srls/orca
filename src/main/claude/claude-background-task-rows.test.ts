import { describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity
} from '../../shared/agent-session-journal-types'
import type { NativeChatBackgroundTaskBlock } from '../../shared/native-chat-types'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { ClaudeBackgroundTaskRows } from './claude-background-task-rows'

/** The exact payloads the user's journal carried for the reported failure. */
const FAILED_UPDATE = {
  type: 'system',
  subtype: 'task_updated',
  task_id: 'byjnee2no',
  patch: { status: 'failed', end_time: 1_789_332_035_695 }
}
const FAILED_NOTIFICATION = {
  type: 'system',
  subtype: 'task_notification',
  task_id: 'byjnee2no',
  tool_use_id: 'toolu_01CqPd7y',
  status: 'failed',
  output_file: '/private/tmp/claude-501/tasks/byjnee2no.output',
  summary: 'Background command "Wait for the verification verdict" failed with exit code 1'
}

function blockOf(body: AgentJournalItemBody | undefined): NativeChatBackgroundTaskBlock | null {
  if (!body || body.kind !== 'message') {
    return null
  }
  const block = body.blocks.find(
    (candidate): candidate is NativeChatBackgroundTaskBlock => candidate.type === 'background-task'
  )
  return block ?? null
}

function twinOf(body: AgentJournalItemBody | undefined): string | null {
  if (!body || body.kind !== 'message') {
    return null
  }
  const block = body.blocks.find((candidate) => candidate.type === 'text')
  return block?.type === 'text' ? block.text : null
}

/** The spawn call the harness treats as forwarded to the top-level transcript.
 *  Admission consults this, so a test that wants a row must name it. */
const FORWARDED_TOOL = 'toolu_01CqPd7y'

function harness(forwarded: readonly string[] = [FORWARDED_TOOL, 'toolu_first', 'toolu_second']) {
  const items: { identity: AgentJournalItemIdentity; body: AgentJournalItemBody }[] = []
  const sink: StructuredAgentSessionEventSink = {
    appendItem: (identity, body) => items.push({ identity, body }),
    appendTombstone: vi.fn(),
    publish: vi.fn()
  }
  let clock = 1_000
  const forwardedTools = new Set(forwarded)
  const rows = new ClaudeBackgroundTaskRows({
    sink,
    isForwardedParentTool: (toolUseId) => forwardedTools.has(toolUseId),
    now: () => (clock += 10)
  })
  const keys = (): string[] =>
    items.map((item) =>
      item.identity.provider === 'orca' ? item.identity.clientMessageId : item.identity.provider
    )
  return {
    rows,
    items,
    keys,
    forwardedTools,
    latest: () => blockOf(items.at(-1)?.body),
    latestTwin: () => twinOf(items.at(-1)?.body)
  }
}

const START_BASH = {
  type: 'system',
  subtype: 'task_started',
  task_id: 'byjnee2no',
  tool_use_id: 'toolu_01CqPd7y',
  task_type: 'local_bash',
  description: 'Wait for the verification verdict',
  is_backgrounded: true
}

describe('claude background task rows', () => {
  it('reports one failed backgrounded command as ONE row carrying the provider sentence', () => {
    const { rows, items, latest, latestTwin } = harness()
    rows.observe(START_BASH)
    rows.observe(FAILED_UPDATE)
    rows.observe(FAILED_NOTIFICATION)

    // One durable identity, not one row per frame: the same failure arrived on
    // two frames and printed twice before this owner existed.
    const identities = new Set(
      items.map((item) =>
        item.identity.provider === 'orca' ? item.identity.clientMessageId : item.identity.provider
      )
    )
    expect([...identities]).toEqual(['claude-background-task:byjnee2no'])
    expect(latest()).toMatchObject({
      type: 'background-task',
      taskId: 'byjnee2no',
      kind: 'command',
      label: 'Wait for the verification verdict',
      state: 'blocked',
      summary: FAILED_NOTIFICATION.summary,
      outputFile: FAILED_NOTIFICATION.output_file
    })
    // The visible text is the provider's own sentence, never the wire opcode.
    expect(latestTwin()).toBe(FAILED_NOTIFICATION.summary)
    expect(latestTwin()).not.toContain('task_notification')
  })

  it('lands the captured failure on its row when the announcement carried no tool id', () => {
    // An announcement naming NO tool is admitted — absence of the field is not
    // evidence of an unforwarded parent — so by the time this REAL captured
    // frame arrives its row already exists and simply takes the sentence.
    const { rows, latestTwin } = harness()
    rows.observe({
      type: 'system',
      subtype: 'task_started',
      task_id: 'bo2vuy8qb',
      task_type: 'local_bash',
      description: 'verify',
      is_backgrounded: true
    })
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'bo2vuy8qb',
      status: 'failed',
      output_file: '',
      summary: "Check the verifier's state"
    })
    expect(latestTwin()).toBe("Check the verifier's state")
  })

  it('drops a terminal frame for a task that was never admitted', () => {
    // Matched on `task_id` alone. The forwarded-parent question was settled at
    // admission and is never re-asked here, so a frame naming nothing this
    // transcript tracks yields no row rather than inventing one.
    const { rows, items } = harness()
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'never-admitted',
      status: 'failed',
      summary: 'orphan failure'
    })
    expect(items).toEqual([])
  })

  it('writes nothing for a silent success it never saw start', () => {
    const { rows, items } = harness()
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'quiet-1',
      status: 'completed'
    })
    expect(items).toEqual([])
  })

  it('leaves agent tasks to the subagent roster', () => {
    const { rows, items } = harness()
    rows.observe({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-agent',
      task_type: 'local_agent',
      subagent_type: 'explorer',
      description: 'Map the lane'
    })
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-agent',
      status: 'failed',
      summary: 'the child failed'
    })
    expect(items).toEqual([])
  })

  it('writes nothing for ambient housekeeping the user never asked for', () => {
    const { rows, items } = harness()
    rows.observe({ ...START_BASH, task_id: 'ambient-1', ambient: true })
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'ambient-1',
      status: 'failed'
    })
    expect(items).toEqual([])
  })

  it('leaves foreground commands to the ordinary transcript path', () => {
    const { rows, items } = harness()
    expect(
      rows.observe({
        ...START_BASH,
        task_id: 'foreground-1',
        is_backgrounded: false
      })
    ).toBe(true)
    expect(
      rows.observe({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'foreground-1',
        status: 'failed',
        summary: 'foreground command failed'
      })
    ).toBe(true)
    expect(items).toEqual([])
  })

  it('revises in place rather than opening a row from a patch', () => {
    const { rows, items, latest } = harness()
    rows.observe({
      type: 'system',
      subtype: 'task_updated',
      task_id: 'never-announced',
      patch: { status: 'running' }
    })
    expect(items).toEqual([])
    rows.observe(START_BASH)
    rows.observe({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'byjnee2no',
      description: 'Running Bash',
      usage: { total_tokens: 1_200 }
    })
    // Progress `description` is the CURRENT ACTIVITY, not the task's name.
    expect(latest()).toMatchObject({ label: 'Wait for the verification verdict', tokens: 1_200 })
  })

  it('takes no row from a terminal patch for an untracked task', () => {
    const { rows, items } = harness()
    expect(
      rows.observe({
        type: 'system',
        subtype: 'task_updated',
        task_id: 'pre-journal',
        patch: { status: 'failed', description: 'Check logs', error: 'boom' }
      })
    ).toBe(true)
    expect(items).toEqual([])
  })

  it('does not resurrect a task whose terminal edge arrived before its start', () => {
    const { rows, items } = harness()
    expect(
      rows.observe({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'done-before-start',
        status: 'completed'
      })
    ).toBe(true)
    expect(rows.observe({ ...START_BASH, task_id: 'done-before-start' })).toBe(true)
    expect(items).toEqual([])
  })

  it('does not resurrect after a terminal update that arrived before start', () => {
    const { rows, items } = harness()
    rows.observe({
      type: 'system',
      subtype: 'task_updated',
      task_id: 'updated-before-start',
      patch: { status: 'completed' }
    })
    rows.observe({ ...START_BASH, task_id: 'updated-before-start' })
    expect(items).toEqual([])
  })

  it('latches a reported outcome against a later live tick', () => {
    const { rows, latest } = harness()
    rows.observe(START_BASH)
    rows.observe(FAILED_NOTIFICATION)
    rows.observe({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'byjnee2no', task_type: 'local_bash', description: 'still listed' }]
    })
    expect(latest()).toMatchObject({ state: 'blocked' })
  })

  it('reopens a settled row when Claude re-announces the same task id with a new tool id', () => {
    const { rows, latest } = harness()
    rows.observe({ ...START_BASH, task_id: 'resume-1', tool_use_id: 'toolu_first' })
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'resume-1',
      tool_use_id: 'toolu_first',
      status: 'completed',
      summary: 'first run finished'
    })
    expect(latest()).toMatchObject({ state: 'done', summary: 'first run finished' })

    rows.observe({
      ...START_BASH,
      task_id: 'resume-1',
      tool_use_id: 'toolu_second',
      status: 'running',
      description: 'Second run'
    })
    expect(latest()).toMatchObject({ state: 'working', label: 'Second run' })
    expect(latest()).not.toHaveProperty('summary')

    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'resume-1',
      tool_use_id: 'toolu_second',
      status: 'failed',
      summary: 'second run failed'
    })
    expect(latest()).toMatchObject({ state: 'blocked', summary: 'second run failed' })
  })

  // Entries carry `{task_id, task_type, description, ambient?}` and NOTHING
  // else — no per-entry status — so these use the real payload shape.
  it('takes identity from the aggregate roster', () => {
    const { rows, latest } = harness()
    rows.observe({ ...START_BASH, task_id: 'aggregate-1', description: undefined })
    expect(latest()).toMatchObject({ label: '', state: 'working' })

    rows.observe({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'aggregate-1', task_type: 'local_bash', description: 'Named by roster' }]
    })

    expect(latest()).toMatchObject({ label: 'Named by roster', state: 'working' })
  })

  // NOT an ablation of the status-read removal: that removal is behaviour-neutral
  // on every real payload, which is exactly why the branch it fed was dead. This
  // pins the standing latch rule instead — presence is a level signal whose
  // ordering against the start/stop edges is unspecified and which carries no
  // evidence of a new run, so a row that reported its own outcome keeps it.
  it('does not let mere presence in the live set revive a settled row', () => {
    const { rows, latest } = harness()
    rows.observe({ ...START_BASH, task_id: 'aggregate-2' })
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'aggregate-2',
      status: 'completed'
    })
    expect(latest()).toMatchObject({ state: 'done' })

    rows.observe({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'aggregate-2', task_type: 'local_bash', description: 'still listed' }]
    })

    expect(latest()).toMatchObject({ state: 'done' })
  })

  it('excludes ambient housekeeping from the aggregate roster', () => {
    const { rows, latest } = harness()
    rows.observe({ ...START_BASH, task_id: 'aggregate-3', description: undefined })
    rows.observe({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        {
          task_id: 'aggregate-3',
          task_type: 'local_bash',
          description: 'housekeeping name',
          ambient: true
        }
      ]
    })
    expect(latest()).toMatchObject({ label: '' })
  })

  it('never burns a revision on a duplicate delivery', () => {
    const { rows, items } = harness()
    rows.observe(START_BASH)
    const afterStart = items.length
    rows.observe(START_BASH)
    expect(items.length).toBe(afterStart)
  })

  it('claims a resumed task announced under a new tool id', () => {
    const { rows, items, latest } = harness()
    rows.observe(START_BASH)
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      tool_use_id: 'toolu_01CqPd7y',
      status: 'failed',
      summary: 'it failed'
    })
    expect(items.at(-1)?.identity).toMatchObject({
      clientMessageId: 'claude-background-task:byjnee2no'
    })
    expect(latest()).toMatchObject({ taskId: 'byjnee2no', state: 'blocked' })
  })

  it('rejects overlong tool-use aliases instead of clipping them into collisions', () => {
    // The row is opened under a usable alias; a later frame carrying an
    // oversized one must resolve to NO task rather than being clipped into this
    // one and attaching another task's failure to it.
    const { rows, items, latest } = harness()
    rows.observe({ ...START_BASH, task_id: 'task-a' })
    const afterStart = items.length

    expect(
      rows.observe({
        type: 'system',
        subtype: 'task_notification',
        tool_use_id: `${'x'.repeat(512)}A`,
        status: 'failed',
        summary: 'misattributed failure'
      })
    ).toBe(false)
    expect(items).toHaveLength(afterStart)
    expect(latest()).toMatchObject({ taskId: 'task-a', state: 'working' })
  })

  it('evicts settled rows so the lifetime cap cannot drop a later failure', () => {
    const { rows, latest } = harness()
    for (let index = 0; index < 64; index += 1) {
      rows.observe({ ...START_BASH, task_id: `settled-${index}` })
      rows.observe({
        type: 'system',
        subtype: 'task_notification',
        task_id: `settled-${index}`,
        status: 'completed'
      })
    }

    rows.observe({ ...START_BASH, task_id: 'overflow' })
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'overflow',
      status: 'failed',
      summary: 'overflow failed'
    })

    expect(latest()).toMatchObject({
      taskId: 'overflow',
      state: 'blocked',
      summary: 'overflow failed'
    })
  })

  it('declines coverage so the fallback still reports when every row slot is live', () => {
    // The row map is bounded. A task that cannot be admitted for lack of a slot
    // is not silently swallowed: coverage is declined so the generic fallback
    // reports it instead.
    const { rows } = harness()
    for (let index = 0; index < 64; index += 1) {
      rows.observe({ ...START_BASH, task_id: `live-${index}` })
    }
    expect(rows.observe({ ...START_BASH, task_id: 'overflow-live' })).toBe(false)
  })

  it('bounds foreign-owner memory for tasks rendered elsewhere', () => {
    const { rows } = harness()
    for (let index = 0; index < 600; index += 1) {
      rows.observe({
        type: 'system',
        subtype: 'task_started',
        task_id: `agent-${index}`,
        task_type: 'local_agent',
        subagent_type: 'explorer'
      })
    }

    const foreign = Reflect.get(rows, 'foreign')
    expect(foreign).toBeInstanceOf(Map)
    expect(foreign.size).toBeLessThanOrEqual(512)
  })

  it('loses contact rather than claiming an outcome when the provider goes away', () => {
    const { rows, latest, latestTwin } = harness()
    rows.observe(START_BASH)
    rows.dispose()
    expect(latest()).toMatchObject({ state: 'unverifiable' })
    // The frozen sentence a client without the block type reads must not assert
    // a liveness only the dead process could have observed.
    expect(latestTwin()).toBe(
      'Background command "Wait for the verification verdict" stopped reporting'
    )
  })

  it('states only that a live task was started, never that it is still running', () => {
    const { rows, latestTwin } = harness()
    rows.observe(START_BASH)
    expect(latestTwin()).toBe('Started background command "Wait for the verification verdict"')
  })

  it('declines frames it does not own', () => {
    const { rows } = harness()
    expect(rows.observe({ type: 'system', subtype: 'init' })).toBe(false)
    expect(rows.observe({ type: 'assistant' })).toBe(false)
    expect(rows.observe({ type: 'system', subtype: 'task_started', task_id: 'x' })).toBe(true)
  })
  it('refuses a nested child whose spawning tool was never forwarded', () => {
    // A Task spawned inside a subagent's sidechain names a tool id that only
    // exists in that sidechain. A top-level row for it would claim an
    // invocation the user never saw.
    const { rows, items } = harness([])
    rows.observe({ ...START_BASH, task_id: 'nested-1', tool_use_id: 'toolu_sidechain' })
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'nested-1',
      tool_use_id: 'toolu_sidechain',
      status: 'failed',
      summary: 'the nested child failed'
    })
    expect(items).toEqual([])
  })

  it('never lets a monitor reach the timeline', () => {
    // A monitor is Claude's own housekeeping: it runs for the life of the
    // session and has no outcome a transcript row could report.
    const { rows, items } = harness()
    rows.observe({
      type: 'system',
      subtype: 'task_started',
      task_id: 'monitor-1',
      tool_use_id: FORWARDED_TOOL,
      task_type: 'monitor',
      description: 'Watch the build',
      is_backgrounded: true
    })
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'monitor-1',
      status: 'failed',
      summary: 'monitor stopped'
    })
    expect(items).toEqual([])
  })

  it('admits a task type it does not recognise as no task at all', () => {
    const { rows, items } = harness()
    rows.observe({ ...START_BASH, task_id: 'weird-1', task_type: 'local_teleport' })
    expect(items).toEqual([])
  })

  it('gives a reused task id a fresh row instead of overwriting the finished run', () => {
    const { rows, keys, latest } = harness([FORWARDED_TOOL, 'toolu_second_run'])
    rows.observe(START_BASH)
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'byjnee2no',
      status: 'failed',
      summary: 'first run failed'
    })
    rows.observe({ ...START_BASH, tool_use_id: 'toolu_second_run' })
    const written = [...new Set(keys())]
    expect(written).toEqual([
      'claude-background-task:byjnee2no',
      'claude-background-task:byjnee2no#2'
    ])
    expect(latest()).toMatchObject({ state: 'working', parentToolUseId: 'toolu_second_run' })
  })

  it('carries the spawning tool call on the row', () => {
    const { rows, latest } = harness()
    rows.observe(START_BASH)
    expect(latest()).toMatchObject({ parentToolUseId: FORWARDED_TOOL })
  })

  it('does not re-open a task that is already running', () => {
    // A redelivered announcement is not a second run. The row it would revise
    // is one the user is already reading, so it yields no deltas at all — even
    // when the redelivery carries metadata the first announcement lacked.
    const { rows, items, latest } = harness()
    rows.observe({ ...START_BASH, description: undefined })
    const afterStart = items.length
    expect(latest()).toMatchObject({ label: '', state: 'working' })

    rows.observe({ ...START_BASH, description: 'Named on redelivery' })
    expect(items.length).toBe(afterStart)
    expect(latest()).toMatchObject({ label: '' })
  })
})
