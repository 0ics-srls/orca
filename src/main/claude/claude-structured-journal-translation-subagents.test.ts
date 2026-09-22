import { describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity
} from '../../shared/agent-session-journal-types'
import type {
  NativeChatSubagentEntry,
  NativeChatSubagentGroupBlock
} from '../../shared/native-chat-types'
import type {
  StructuredAgentSessionAppendOptions,
  StructuredAgentSessionEventSink
} from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { createClaudeJournalTranslator } from './claude-structured-journal-translation'

const GROUP_ITEM_ID = 'claude-subagents:claude-session:user-1'

/** The union's other arms carry no client message id, so reading one narrows. */
function orcaClientMessageId(identity: AgentJournalItemIdentity): string | null {
  return identity.provider === 'orca' ? identity.clientMessageId : null
}

function harness() {
  // `options` is captured, not declared away: producer attribution rides the
  // third argument, and a harness that drops it makes every assertion about
  // attribution pass against `undefined`.
  const items: {
    identity: AgentJournalItemIdentity
    body: AgentJournalItemBody
    options: StructuredAgentSessionAppendOptions | undefined
  }[] = []
  const sink: StructuredAgentSessionEventSink = {
    appendItem: (identity, body, options) => items.push({ identity, body, options }),
    appendTombstone: vi.fn(),
    publish: vi.fn()
  }
  const translator = createClaudeJournalTranslator({ sink, fallbackIdPrefix: 'test' })
  const groupRows = () =>
    items.filter((item) => orcaClientMessageId(item.identity) === GROUP_ITEM_ID)
  const agentsOf = (body: AgentJournalItemBody | undefined): NativeChatSubagentEntry[] => {
    if (!body || body.kind !== 'message') {
      return []
    }
    const block = body.blocks.find(
      (candidate): candidate is NativeChatSubagentGroupBlock => candidate.type === 'subagent-group'
    )
    return block ? block.agents : []
  }
  /** The last roster row written for one group, so a test can read a group that
   *  is no longer the live one. */
  const rosterIn = (groupId: string): NativeChatSubagentEntry[] =>
    agentsOf(
      items.findLast((item) => orcaClientMessageId(item.identity) === `claude-subagents:${groupId}`)
        ?.body
    )
  const rosterOf = (turnUuid: string): NativeChatSubagentEntry[] =>
    rosterIn(`claude-session:${turnUuid}`)
  const roster = (): NativeChatSubagentEntry[] => agentsOf(groupRows().at(-1)?.body)
  const fallbackRows = (): AgentJournalItemBody[] =>
    items
      .filter((item) => (orcaClientMessageId(item.identity) ?? '').startsWith('provider-frame:'))
      .map((item) => item.body)
  /** Attribution stamped on a row, found by the text it carries, so a test
   *  names the row it means instead of indexing into the append order. */
  const linkageOfProse = (text: string): StructuredAgentSessionAppendOptions | undefined =>
    items.find(
      (entry) =>
        entry.body.kind === 'message' &&
        entry.body.blocks.some((block) => block.type === 'text' && block.text === text)
    )?.options
  return { translator, items, groupRows, roster, rosterIn, rosterOf, fallbackRows, linkageOfProse }
}

function userTurn(uuid: string) {
  return {
    type: 'message' as const,
    sessionId: 'orca-session',
    startsTurn: true as const,
    message: {
      type: 'user',
      uuid,
      session_id: 'claude-session',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text: 'go' }] }
    }
  }
}

function systemFrame(subtype: string, fields: Record<string, unknown>) {
  return {
    type: 'message' as const,
    sessionId: 'orca-session',
    message: { type: 'system', subtype, session_id: 'claude-session', ...fields }
  }
}

function spawnResult(uuid: string, toolUseId: string) {
  return {
    type: 'message' as const,
    sessionId: 'orca-session',
    message: {
      type: 'user',
      uuid,
      session_id: 'claude-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'done' }]
      }
    }
  }
}

function resultFrame() {
  return {
    type: 'message' as const,
    sessionId: 'orca-session',
    message: {
      type: 'result',
      subtype: 'success',
      session_id: 'claude-session',
      uuid: 'result-1',
      result: 'ok'
    }
  }
}

describe('claude journal translation — subagents', () => {
  it('rosters a spawned subagent and settles it on the spawn call result', () => {
    const { translator, roster, fallbackRows } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(
      systemFrame('task_started', {
        task_id: 'task-1',
        tool_use_id: 'toolu_1',
        task_type: 'local_agent',
        subagent_type: 'explorer',
        description: 'Map the lane'
      })
    )
    expect(roster()).toEqual([
      expect.objectContaining({ id: 'task-1', label: 'Map the lane', state: 'working' })
    ])
    // The task frames stay status-chrome, so none of them prints an opcode row.
    expect(fallbackRows()).toEqual([])
    translator.handle(spawnResult('user-2', 'toolu_1'))
    expect(roster()).toEqual([expect.objectContaining({ state: 'completed' })])
  })

  it('marks a child still working at turn end unverifiable', () => {
    const { translator, roster } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(
      systemFrame('task_started', {
        task_id: 'task-1',
        task_type: 'local_agent',
        description: 'Map the lane'
      })
    )
    translator.handle(resultFrame())
    expect(roster()).toEqual([expect.objectContaining({ state: 'unverifiable' })])
  })

  it('leaves a backgrounded child running past the end of its turn', () => {
    const { translator, roster } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(
      systemFrame('task_started', {
        task_id: 'task-1',
        tool_use_id: 'toolu_1',
        task_type: 'local_agent',
        description: 'Watch the build',
        is_backgrounded: true
      })
    )
    // A backgrounded spawn returns its tool result immediately; the child runs on.
    translator.handle(spawnResult('user-2', 'toolu_1'))
    translator.handle(resultFrame())
    expect(roster()).toEqual([expect.objectContaining({ state: 'working' })])
    translator.handle({ type: 'ended', sessionId: 'orca-session', reason: 'closed' })
    expect(roster()).toEqual([expect.objectContaining({ state: 'unverifiable' })])
  })

  it('keeps a backgrounded shell task out of the roster entirely', () => {
    const { translator, groupRows } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(
      systemFrame('task_started', {
        task_id: 'task-bash',
        tool_use_id: 'toolu_bash',
        task_type: 'local_bash',
        description: 'sleep 20',
        is_backgrounded: true
      })
    )
    translator.handle(resultFrame())
    expect(groupRows()).toEqual([])
  })

  it('shows a subagent whose release announces no task frames, from its child traffic', () => {
    const { translator, roster } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle({
      type: 'message' as const,
      sessionId: 'orca-session',
      message: {
        type: 'assistant',
        uuid: 'child-1',
        session_id: 'claude-session',
        parent_tool_use_id: 'toolu_1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'looking' }] }
      }
    })
    expect(roster()).toEqual([
      expect.objectContaining({ id: 'toolu_1', label: 'subagent', state: 'working' })
    ])
  })

  it('settles the turn a new turn superseded, and leaves the new one running', () => {
    const { translator, rosterOf } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(
      systemFrame('task_started', {
        task_id: 'task-1',
        task_type: 'local_agent',
        description: 'First turn'
      })
    )
    // A second turn starts with no result frame for the first: the first turn
    // ends here, and nothing else will ever name its group again.
    translator.handle(userTurn('user-2'))
    translator.handle(
      systemFrame('task_started', {
        task_id: 'task-2',
        task_type: 'local_agent',
        description: 'Second turn'
      })
    )
    expect(rosterOf('user-1')).toEqual([expect.objectContaining({ state: 'unverifiable' })])
    expect(rosterOf('user-2')).toEqual([expect.objectContaining({ state: 'working' })])
  })

  it('does not let an unrelated turn end settle a child announced outside a turn', () => {
    const { translator, rosterIn } = harness()
    // No turn is live yet, so this child has no turn key to belong to.
    translator.handle(
      systemFrame('task_started', {
        task_id: 'task-early',
        task_type: 'local_agent',
        description: 'Before the turn'
      })
    )
    translator.handle(userTurn('user-1'))
    translator.handle(resultFrame())
    expect(rosterIn('outside-turn')).toEqual([expect.objectContaining({ state: 'working' })])
    // The outcome still lands, which a latched `unverifiable` would have lost.
    translator.handle(
      systemFrame('task_updated', { task_id: 'task-early', patch: { status: 'completed' } })
    )
    expect(rosterIn('outside-turn')).toEqual([expect.objectContaining({ state: 'completed' })])
  })

  it('settles a child left outside every turn when the session ends', () => {
    const { translator, rosterIn } = harness()
    translator.handle(
      systemFrame('task_started', {
        task_id: 'task-early',
        task_type: 'local_agent',
        description: 'Before the turn'
      })
    )
    translator.handle(userTurn('user-1'))
    translator.handle(resultFrame())
    translator.handle({ type: 'ended', sessionId: 'orca-session', reason: 'closed' })
    expect(rosterIn('outside-turn')).toEqual([expect.objectContaining({ state: 'unverifiable' })])
  })
})

describe('claude journal translation — which agent produced a row', () => {
  /** One child assistant frame carrying prose, parented to a spawn call. */
  function childProse(uuid: string, parentToolUseId: string, text: string) {
    return {
      type: 'message' as const,
      sessionId: 'orca-session',
      message: {
        type: 'assistant',
        uuid,
        session_id: 'claude-session',
        parent_tool_use_id: parentToolUseId,
        message: { role: 'assistant', content: [{ type: 'text', text }] }
      }
    }
  }

  /** The parent's own `Task` call, which is what forwards the spawn id. */
  function spawnCall(uuid: string, toolUseId: string) {
    return {
      type: 'message' as const,
      sessionId: 'orca-session',
      message: {
        type: 'assistant',
        uuid,
        session_id: 'claude-session',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: toolUseId, name: 'Task', input: { description: 'explore' } }
          ]
        }
      }
    }
  }

  function announce(taskId: string, toolUseId: string) {
    return systemFrame('task_started', {
      task_id: taskId,
      tool_use_id: toolUseId,
      task_type: 'local_agent',
      subagent_type: 'explorer',
      description: 'Map the lane'
    })
  }

  it("stamps the child's canonical task id, not the spawn call's rotating id", () => {
    const { translator, linkageOfProse } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(spawnCall('assistant-1', 'toolu_1'))
    translator.handle(announce('task-1', 'toolu_1'))
    translator.handle(childProse('child-1', 'toolu_1', 'looking'))

    expect(linkageOfProse('looking')).toMatchObject({
      agentId: 'task-1',
      providerParentRef: 'toolu_1',
      producerKind: 'agent'
    })
  })

  it("leaves the parent's own rows unstamped, which is what makes absence mean root", () => {
    const { translator, linkageOfProse } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle({
      type: 'message' as const,
      sessionId: 'orca-session',
      message: {
        type: 'assistant',
        uuid: 'assistant-1',
        session_id: 'claude-session',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'text', text: 'delegating' }] }
      }
    })
    // A control, not a pin: the parent's rows carry no linkage before this
    // change either. It is here because "absence means root" is only sound
    // while the producer really does leave its own rows alone.
    expect(linkageOfProse('delegating')?.agentId).toBeUndefined()
  })

  it('keeps one identity across a resume that re-mints the spawn call id', () => {
    // THE case the canonical id exists for: the same child announced twice
    // under two different tool ids. Both runs' rows must name one agent.
    const { translator, linkageOfProse } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(spawnCall('assistant-1', 'toolu_1'))
    translator.handle(announce('task-1', 'toolu_1'))
    translator.handle(childProse('child-1', 'toolu_1', 'first run'))

    translator.handle(spawnCall('assistant-2', 'toolu_2'))
    translator.handle(announce('task-1', 'toolu_2'))
    translator.handle(childProse('child-2', 'toolu_2', 'second run'))

    expect(linkageOfProse('first run')?.agentId).toBe('task-1')
    expect(linkageOfProse('second run')?.agentId).toBe('task-1')
    // Identity answers "which agent"; the attempt answers "which run of it".
    expect(linkageOfProse('first run')?.attempt).toBeUndefined()
    expect(linkageOfProse('second run')?.attempt).toBe(2)
  })

  it('holds a child row that arrives before its announcement, then writes it linked', () => {
    const { translator, linkageOfProse } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(spawnCall('assistant-1', 'toolu_1'))
    // Another child has already proven this release announces its tasks, so a
    // spawn with no announcement yet is a window, not a release without one.
    translator.handle(announce('task-other', 'toolu_other'))
    translator.handle(childProse('child-1', 'toolu_1', 'arrived early'))

    // Held: nothing may be written under the spawn call's own rotating id.
    expect(linkageOfProse('arrived early')).toBeUndefined()

    translator.handle(announce('task-1', 'toolu_1'))

    // Released under the canonical id — not dropped, and not the parent's.
    expect(linkageOfProse('arrived early')).toMatchObject({
      agentId: 'task-1',
      providerParentRef: 'toolu_1'
    })
  })

  it('writes a held row rather than losing it when no announcement ever comes', () => {
    // Anti-swallow: the turn ends with the identity still provisional. The row
    // is written under the only handle there is, and still as a child's.
    const { translator, linkageOfProse } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(spawnCall('assistant-1', 'toolu_1'))
    translator.handle(announce('task-other', 'toolu_other'))
    translator.handle(childProse('child-1', 'toolu_1', 'never announced'))
    expect(linkageOfProse('never announced')).toBeUndefined()

    translator.handle(resultFrame())

    expect(linkageOfProse('never announced')).toMatchObject({
      agentId: 'toolu_1',
      providerParentRef: 'toolu_1'
    })
  })

  it("reads a release that announces no task at all as the session's own", () => {
    // Settled behaviour for older CLI releases: nothing stable is reachable for
    // their children, and an id that rotates is worse than no id. These rows
    // read exactly as they do today, so the defect persists on those releases.
    // Paired with the nested-sidechain case below, which shows the SAME kind of
    // never-announced reference IS stamped once a release has announced one.
    const { translator, linkageOfProse } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(spawnCall('assistant-1', 'toolu_1'))
    translator.handle(childProse('child-1', 'toolu_1', 'unannounced release'))

    expect(linkageOfProse('unannounced release')?.agentId).toBeUndefined()
  })

  it('stamps nested sidechain traffic this release will never announce', () => {
    // A grandchild parented to a tool id that only ever existed inside a
    // sidechain. No announcement is coming, so the raw reference is the only
    // handle — but the row is still a child's, never the parent's.
    const { translator, linkageOfProse } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(spawnCall('assistant-1', 'toolu_1'))
    translator.handle(announce('task-1', 'toolu_1'))
    translator.handle(childProse('grandchild-1', 'toolu_nested', 'deeper'))

    expect(linkageOfProse('deeper')).toMatchObject({
      agentId: 'toolu_nested',
      providerParentRef: 'toolu_nested'
    })
  })

  it('classifies a backgrounded shell task as background work, not as an agent', () => {
    const { translator, linkageOfProse } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(spawnCall('assistant-1', 'toolu_bash'))
    translator.handle(
      systemFrame('task_started', {
        task_id: 'task-bash',
        tool_use_id: 'toolu_bash',
        task_type: 'local_bash',
        description: 'sleep 20',
        is_backgrounded: true
      })
    )
    translator.handle(childProse('bash-1', 'toolu_bash', 'shell output'))

    expect(linkageOfProse('shell output')).toMatchObject({ producerKind: 'background' })
  })

  it("leaves the spawn-group row the parent's, though a child frame triggered it", () => {
    // Hazard: the group row is written from a child's frame but describes the
    // PARENT's children. Stamping it as a child's would hide the roster from
    // the very row that owns it. Asserted on the written row, not on a field.
    const { translator, groupRows } = harness()
    translator.handle(userTurn('user-1'))
    translator.handle(spawnCall('assistant-1', 'toolu_1'))
    translator.handle(announce('task-1', 'toolu_1'))
    translator.handle(childProse('child-1', 'toolu_1', 'looking'))

    const groupRow = groupRows().at(-1)
    expect(groupRow).toBeDefined()
    expect(groupRow?.options?.agentId).toBeUndefined()
  })
})
