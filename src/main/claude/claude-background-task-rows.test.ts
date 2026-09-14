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

function harness() {
  const items: { identity: AgentJournalItemIdentity; body: AgentJournalItemBody }[] = []
  const sink: StructuredAgentSessionEventSink = {
    appendItem: (identity, body) => items.push({ identity, body }),
    appendTombstone: vi.fn(),
    publish: vi.fn()
  }
  let clock = 1_000
  const rows = new ClaudeBackgroundTaskRows({ sink, now: () => (clock += 10) })
  return {
    rows,
    items,
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

  it('opens a row for a failure whose announcement this session never saw', () => {
    const { rows, latest, latestTwin } = harness()
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'bo2vuy8qb',
      status: 'failed',
      output_file: '',
      summary: "Check the verifier's state"
    })
    expect(latest()).toMatchObject({ taskId: 'bo2vuy8qb', state: 'blocked', kind: 'unknown' })
    expect(latestTwin()).toBe("Check the verifier's state")
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

  it('opens a row for a terminal update that arrives before the announcement', () => {
    const { rows, latest, latestTwin } = harness()
    expect(
      rows.observe({
        type: 'system',
        subtype: 'task_updated',
        task_id: 'pre-journal',
        patch: { status: 'failed', description: 'Check logs', error: 'boom' }
      })
    ).toBe(true)

    expect(latest()).toMatchObject({
      taskId: 'pre-journal',
      label: 'Check logs',
      state: 'blocked',
      error: 'boom'
    })
    expect(latestTwin()).toBe('boom')
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
      tasks: [{ task_id: 'byjnee2no', status: 'running' }]
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

  it('lets an aggregate live roster reopen a settled same-id row', () => {
    const { rows, latest } = harness()
    rows.observe({ ...START_BASH, task_id: 'aggregate-resume' })
    rows.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'aggregate-resume',
      status: 'completed'
    })

    rows.observe({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        {
          task_id: 'aggregate-resume',
          status: 'running',
          task_type: 'local_bash',
          description: 'Resumed by roster'
        }
      ]
    })

    expect(latest()).toMatchObject({ state: 'working', label: 'Resumed by roster' })
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
    const { rows, items, latest } = harness()
    const overlong = `${'x'.repeat(512)}A`
    rows.observe({ ...START_BASH, task_id: 'task-a', tool_use_id: overlong })
    const afterStart = items.length

    expect(
      rows.observe({
        type: 'system',
        subtype: 'task_notification',
        tool_use_id: overlong,
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

  it('declines coverage so fallback can report a failure when every row is live', () => {
    const { rows, items } = harness()
    for (let index = 0; index < 64; index += 1) {
      rows.observe({ ...START_BASH, task_id: `live-${index}` })
    }

    expect(
      rows.observe({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'overflow-live',
        status: 'failed',
        summary: 'overflow failed'
      })
    ).toBe(false)
    expect(
      items.some((item) =>
        item.identity.provider === 'orca'
          ? item.identity.clientMessageId === 'claude-background-task:overflow-live'
          : false
      )
    ).toBe(false)
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
})
