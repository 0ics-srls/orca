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

function playFailedBackgroundCommand(translator: ReturnType<typeof harness>['translator']): void {
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

  it('settles live background rows when the provider ends before disposal', () => {
    const { translator, taskRowTexts } = harness()
    translator.handle(
      systemFrame({
        subtype: 'task_started',
        task_id: TASK_ID,
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
})
