import { describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity
} from '../../shared/agent-session-journal-types'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { createClaudeJournalTranslator } from './claude-structured-journal-translation'

// The frames below are the ones the reported session actually carried: two real
// failures that printed THREE red rows whose visible text was the wire opcode,
// two of them for the same task.
const TASK_ID = 'byjnee2no'
const SUMMARY = 'Background command "Wait for the verification verdict" failed with exit code 1'

function orcaClientMessageId(identity: AgentJournalItemIdentity): string | null {
  return identity.provider === 'orca' ? identity.clientMessageId : null
}

function harness() {
  const items: { identity: AgentJournalItemIdentity; body: AgentJournalItemBody }[] = []
  const sink: StructuredAgentSessionEventSink = {
    appendItem: (identity, body) => items.push({ identity, body }),
    appendTombstone: vi.fn(),
    publish: vi.fn()
  }
  const translator = createClaudeJournalTranslator({ sink, fallbackIdPrefix: 'test' })
  const rowsWithPrefix = (prefix: string): AgentJournalItemBody[] =>
    items
      .filter((item) => (orcaClientMessageId(item.identity) ?? '').startsWith(prefix))
      .map((item) => item.body)
  const textOf = (body: AgentJournalItemBody): string => {
    if (body.kind === 'status') {
      return body.text
    }
    return body.kind === 'message'
      ? body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ')
      : ''
  }
  return {
    translator,
    items,
    /** Generic unknown-frame rows — the ones that printed `claude · <opcode>`. */
    fallbackRows: () => rowsWithPrefix('provider-frame:').map(textOf),
    taskRowIds: () =>
      items
        .map((item) => orcaClientMessageId(item.identity) ?? '')
        .filter((id) => id.startsWith('claude-background-task:')),
    taskRowTexts: () => rowsWithPrefix('claude-background-task:').map(textOf)
  }
}

function systemFrame(fields: Record<string, unknown>) {
  return {
    type: 'message' as const,
    sessionId: 'orca-session',
    message: { type: 'system', session_id: 'claude-session', ...fields }
  }
}

/** The assistant turn that invokes the spawn tool. Admission consults it: a task
 *  whose spawning tool never reached the transcript is a nested child, so every
 *  realistic sequence forwards this first. */
function spawnToolCall(
  translator: ReturnType<typeof harness>['translator'],
  toolUseId = 'toolu_01CqPd7y'
): void {
  translator.handle({
    type: 'message' as const,
    sessionId: 'orca-session',
    message: {
      type: 'assistant',
      uuid: `assistant-${toolUseId}`,
      session_id: 'claude-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command: 'wait' } }]
      }
    }
  })
}

function playFailedBackgroundCommand(translator: ReturnType<typeof harness>['translator']): void {
  spawnToolCall(translator)
  translator.handle(
    systemFrame({
      subtype: 'task_started',
      task_id: TASK_ID,
      tool_use_id: 'toolu_01CqPd7y',
      task_type: 'local_bash',
      description: 'Wait for the verification verdict',
      is_backgrounded: true
    })
  )
  translator.handle(
    systemFrame({
      subtype: 'task_updated',
      task_id: TASK_ID,
      patch: { status: 'failed', end_time: 1_789_332_035_695 }
    })
  )
  translator.handle(
    systemFrame({
      subtype: 'task_notification',
      task_id: TASK_ID,
      tool_use_id: 'toolu_01CqPd7y',
      status: 'failed',
      output_file: '/private/tmp/claude-501/tasks/byjnee2no.output',
      summary: SUMMARY
    })
  )
}

describe('claude journal translation — background task rows', () => {
  it('prints the provider sentence once instead of the opcode twice', () => {
    const { translator, fallbackRows, taskRowIds, taskRowTexts } = harness()
    playFailedBackgroundCommand(translator)

    // ABLATION: drop `message:system:task_*` from CLAUDE_TYPED_TRANSLATOR_KINDS
    // and this is `['claude · message:system:task_updated', 'claude ·
    // message:system:task_notification']` — the reported bug exactly.
    expect(fallbackRows()).toEqual([])
    // One durable row for one task, however many frames reported it.
    expect(new Set(taskRowIds())).toEqual(new Set([`claude-background-task:${TASK_ID}`]))
    expect(taskRowTexts().at(-1)).toBe(SUMMARY)
  })

  it('keeps the aggregate roster frame off the transcript even when it carries a failure', () => {
    const { translator, fallbackRows, taskRowIds } = harness()
    translator.handle(
      systemFrame({
        subtype: 'background_tasks_changed',
        tasks: [{ task_id: TASK_ID, status: 'failed', task_type: 'local_bash' }]
      })
    )
    // It promotes through the payload sniffer exactly as the per-task frames do,
    // and it creates no row of its own: the task's own frames own that.
    expect(fallbackRows()).toEqual([])
    expect(taskRowIds()).toEqual([])
  })

  it('still surfaces an unmodelled failed frame through the generic fallback', () => {
    const { translator, fallbackRows } = harness()
    translator.handle(systemFrame({ subtype: 'future_event', status: 'failed' }))
    // The coverage contract is per-kind, so nothing about it weakens the payload
    // sniffer for the kinds nobody has modelled.
    expect(fallbackRows()).toEqual(['claude · message:system:future_event'])
  })

  it('falls back visibly when a malformed task frame reports a failure', () => {
    const { translator, fallbackRows, taskRowIds } = harness()
    translator.handle(
      systemFrame({
        subtype: 'task_notification',
        status: 'failed',
        summary: 'Background command "Wait" failed with exit code 1'
      })
    )

    expect(taskRowIds()).toEqual([])
    expect(fallbackRows()).toEqual(['Background command "Wait" failed with exit code 1'])
  })

  it('keeps a refused live task failure visible through the generic fallback', () => {
    const { translator, fallbackRows } = harness()
    for (let index = 0; index < 64; index += 1) {
      const toolUseId = `toolu-live-${index}`
      spawnToolCall(translator, toolUseId)
      translator.handle(
        systemFrame({
          subtype: 'task_started',
          task_id: `live-${index}`,
          tool_use_id: toolUseId,
          task_type: 'local_bash',
          description: `live ${index}`,
          is_backgrounded: true
        })
      )
    }

    spawnToolCall(translator, 'toolu-overflow')
    translator.handle(
      systemFrame({
        subtype: 'task_started',
        task_id: 'overflow-fallback',
        tool_use_id: 'toolu-overflow',
        task_type: 'local_bash',
        description: 'overflow task',
        is_backgrounded: true
      })
    )
    translator.handle(
      systemFrame({
        subtype: 'task_updated',
        task_id: 'overflow-fallback',
        patch: { status: 'failed' }
      })
    )
    translator.handle(
      systemFrame({
        subtype: 'task_notification',
        task_id: 'overflow-fallback',
        tool_use_id: 'toolu-overflow',
        status: 'failed',
        summary: 'overflow failed'
      })
    )
    translator.handle(
      systemFrame({
        subtype: 'task_progress',
        task_id: 'overflow-fallback',
        usage: { total_tokens: 3 }
      })
    )
    translator.handle(
      systemFrame({
        subtype: 'task_notification',
        task_id: 'overflow-fallback',
        status: 'failed',
        summary: 'duplicate overflow failed'
      })
    )

    expect(fallbackRows().at(-1)).toBe('overflow failed')
    expect(fallbackRows().at(-2)).toBe('Background task failed')
    expect(fallbackRows().at(-2)).not.toContain('message:system:task_')
    expect(fallbackRows()).toHaveLength(2)
  })

  it('settles live background rows when the provider ends before disposal', () => {
    const { translator, taskRowTexts } = harness()
    spawnToolCall(translator)
    translator.handle(
      systemFrame({
        subtype: 'task_started',
        task_id: TASK_ID,
        tool_use_id: 'toolu_01CqPd7y',
        task_type: 'local_bash',
        description: 'Wait for the verification verdict',
        is_backgrounded: true
      })
    )

    translator.handle({ type: 'ended', sessionId: 'orca-session', reason: 'closed' })

    expect(taskRowTexts().at(-1)).toBe(
      'Background command "Wait for the verification verdict" stopped reporting'
    )
  })
  it('keeps a nested child spawned inside a sidechain off the top-level transcript', () => {
    const { translator, taskRowIds, fallbackRows } = harness()
    // The spawn tool call is emitted by a SUBAGENT, so it carries a parent tool
    // id and is never a top-level invocation.
    translator.handle({
      type: 'message' as const,
      sessionId: 'orca-session',
      message: {
        type: 'assistant',
        uuid: 'nested-assistant',
        session_id: 'claude-session',
        parent_tool_use_id: 'toolu_parent_agent',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_sidechain', name: 'Bash', input: { command: 'wait' } }
          ]
        }
      }
    })
    translator.handle(
      systemFrame({
        subtype: 'task_started',
        task_id: 'nested-1',
        tool_use_id: 'toolu_sidechain',
        task_type: 'local_bash',
        description: 'nested work',
        is_backgrounded: true
      })
    )
    translator.handle(
      systemFrame({
        subtype: 'task_notification',
        task_id: 'nested-1',
        tool_use_id: 'toolu_sidechain',
        status: 'failed',
        summary: 'nested child failed'
      })
    )

    expect(taskRowIds()).toEqual([])
    expect(fallbackRows()).toEqual([])
  })

  it('keeps a monitor off the timeline entirely', () => {
    const { translator, taskRowIds, fallbackRows } = harness()
    spawnToolCall(translator)
    translator.handle(
      systemFrame({
        subtype: 'task_started',
        task_id: 'monitor-1',
        tool_use_id: 'toolu_01CqPd7y',
        task_type: 'monitor',
        description: 'Watch the build',
        is_backgrounded: true
      })
    )
    translator.handle(
      systemFrame({
        subtype: 'task_notification',
        task_id: 'monitor-1',
        tool_use_id: 'toolu_01CqPd7y',
        status: 'failed',
        summary: 'monitor stopped'
      })
    )

    expect(taskRowIds()).toEqual([])
    expect(fallbackRows()).toEqual([])
  })
})
