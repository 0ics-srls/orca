// Regression for a structured Claude session that reported idle while it was
// working. Reproduced from the journal of the reported session
// (962e6f25…/epoch 3d214e6f…, 2026-09-13): a `result` settled the turn at
// 13:56:06, a background task reported in at 13:58:59, and the agent then ran
// tool calls until 14:05:18 — nine minutes in which the shared projector, and
// so the sidebar row and the chat indicator, read `idle`.

import { describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity,
  AgentJournalRenderItem
} from '../../shared/agent-session-journal-types'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import { readAgentJournalTurn } from '../../shared/agent-session-turn-record'
import {
  hasUnansweredStructuredAgentSessionDispatch,
  projectStructuredAgentSessionStatus
} from '../../shared/structured-agent-session-projection'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { createClaudeJournalTranslator } from './claude-structured-journal-translation'

const SESSION = 'claude-session'

function harness() {
  const appended: { identity: AgentJournalItemIdentity; body: AgentJournalItemBody }[] = []
  const sink: StructuredAgentSessionEventSink = {
    appendItem: (identity, body) => appended.push({ identity, body }),
    appendTombstone: () => {},
    publish: vi.fn()
  }
  const translator = createClaudeJournalTranslator({ sink, fallbackIdPrefix: 'test' })
  // The reducer keys items by identity and orders them by first append, so the
  // render list the projector reads is the deduplicated append order.
  const items = (): AgentJournalRenderItem[] => {
    const byKey = new Map<string, AgentJournalRenderItem>()
    appended.forEach(({ identity, body }, index) => {
      const key = agentJournalItemKey(identity)
      const existing = byKey.get(key)
      byKey.set(key, {
        itemId: key,
        revision: (existing?.revision ?? 0) + 1,
        body,
        sequence: existing?.sequence ?? index,
        observedAt: index
      })
    })
    return [...byKey.values()].sort((a, b) => a.sequence - b.sequence)
  }
  return { translator, items }
}

function frame(
  type: 'assistant' | 'user',
  uuid: string,
  content: unknown[],
  parentToolUseId: string | null = null
) {
  return {
    type: 'message' as const,
    sessionId: 'orca-session',
    ...(type === 'user' && parentToolUseId === null ? { startsTurn: true as const } : {}),
    message: {
      type,
      uuid,
      session_id: SESSION,
      parent_tool_use_id: parentToolUseId,
      message: { role: type, content }
    }
  }
}

/** The captured `task-notification` wake-up: a main-thread user frame Orca never
 *  dispatched, so it carries no replay waiter and cannot start a turn. */
function taskNotification(uuid: string) {
  return {
    type: 'message' as const,
    sessionId: 'orca-session',
    message: {
      type: 'user',
      uuid,
      session_id: SESSION,
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'text', text: '<task-notification><task-id>bfnmj08v6</task-id>' }]
      }
    }
  }
}

function result(uuid: string) {
  return {
    type: 'message' as const,
    sessionId: 'orca-session',
    message: {
      type: 'result',
      subtype: 'success',
      uuid,
      session_id: SESSION,
      duration_ms: 322_937
    }
  }
}

function projected(items: readonly AgentJournalRenderItem[]): string {
  // No submission is outstanding: the send was acknowledged long ago, which is
  // exactly the state in which the reported session fell back to idle.
  expect(hasUnansweredStructuredAgentSessionDispatch([], null)).toBe(false)
  return projectStructuredAgentSessionStatus(items, [], null)
}

describe('a Claude turn the provider resumed on its own', () => {
  it('reports working while the agent runs tool calls after a result settled the turn', () => {
    const { translator, items } = harness()

    translator.handle(frame('user', 'u1', [{ type: 'text', text: 'go' }]))
    expect(projected(items())).toBe('working')

    translator.handle(result('r1'))
    // The agent really did stop here, so idle is correct.
    expect(projected(items())).toBe('idle')

    // A background task reports in and wakes the agent; it starts working again.
    translator.handle(taskNotification('n1'))
    translator.handle(frame('assistant', 'a1', [{ type: 'text', text: 'Back on it.' }]))
    expect(projected(items())).toBe('working')

    translator.handle(
      frame('assistant', 'a2', [
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'rg foo' } }
      ])
    )
    expect(projected(items())).toBe('working')

    // The next result settles the turn the provider opened, so nothing over-claims.
    translator.handle(result('r2'))
    expect(projected(items())).toBe('idle')
  })

  it('gives the resumed turn its own record, with no user row to anchor to', () => {
    const { translator, items } = harness()
    translator.handle(frame('user', 'u1', [{ type: 'text', text: 'go' }]))
    translator.handle(result('r1'))
    translator.handle(frame('assistant', 'a1', [{ type: 'text', text: 'Back on it.' }]))

    const turns = items().flatMap((item) => {
      const turn = readAgentJournalTurn(item.body)
      return turn ? [turn] : []
    })
    expect(turns.map((turn) => turn.state)).toEqual(['completed', 'running'])
    expect(turns[1]?.turnId).toBe('a1')
    expect(turns[1]?.userItemId).toBeUndefined()
  })

  it('leaves a settled turn settled when only a subagent is still producing', () => {
    const { translator, items } = harness()
    translator.handle(frame('user', 'u1', [{ type: 'text', text: 'go' }]))
    translator.handle(result('r1'))

    // Children outlive the turn that spawned them; their frames are not a turn.
    translator.handle(
      frame('assistant', 'a1', [{ type: 'text', text: 'child work' }], 'toolu_parent')
    )
    expect(projected(items())).toBe('idle')
  })

  it('does not reopen a turn that is already running', () => {
    const { translator, items } = harness()
    translator.handle(frame('user', 'u1', [{ type: 'text', text: 'go' }]))
    translator.handle(frame('assistant', 'a1', [{ type: 'text', text: 'one' }]))
    translator.handle(frame('assistant', 'a2', [{ type: 'text', text: 'two' }]))

    const running = items().filter((item) => readAgentJournalTurn(item.body)?.state === 'running')
    expect(running).toHaveLength(1)
    expect(readAgentJournalTurn(running[0]!.body)?.turnId).toBe('u1')
    expect(projected(items())).toBe('working')
  })
})
