import { describe, expect, it } from 'vitest'
import { readCodexSubagentOrigin } from './session-scanner-codex-subagent-origin'

// Payload shapes below mirror real `session_meta` records: `source.subagent` is
// an externally tagged union, so the spawn record nests under a `thread_spawn`
// tag and the parent, nickname and path are copied onto the payload's own keys
// beside it.
function spawnedPayload(threadSpawn: unknown, payloadCopies: Record<string, unknown> = {}) {
  return {
    id: 'child-thread',
    cwd: '/repo/app',
    thread_source: 'subagent',
    source: { subagent: { thread_spawn: threadSpawn } },
    ...payloadCopies
  }
}

describe('readCodexSubagentOrigin', () => {
  it('keeps every field of a stated spawn record, including a null role', () => {
    const origin = readCodexSubagentOrigin(
      spawnedPayload({
        parent_thread_id: '01a06e83-42af-7741-b975-ab54925540f9',
        depth: 1,
        agent_path: '/root/readiness_final_fresh',
        agent_nickname: 'Pascal',
        agent_role: null
      })
    )

    expect(origin).toEqual({
      kind: 'thread_spawn',
      kindLabel: null,
      threadSource: 'subagent',
      parentage: {
        parentThreadId: '01a06e83-42af-7741-b975-ab54925540f9',
        depth: 1,
        agentNickname: 'Pascal',
        agentRole: null,
        agentPath: '/root/readiness_final_fresh'
      }
    })
  })

  it('carries the depth of a nested child instead of flattening it', () => {
    const origin = readCodexSubagentOrigin(
      spawnedPayload({
        parent_thread_id: 'middle-thread',
        depth: 2,
        agent_path: '/root/pr_review_pass_1/adversarial_correctness',
        agent_nickname: 'Noether',
        agent_role: 'explorer'
      })
    )

    expect(origin?.parentage?.depth).toBe(2)
    expect(origin?.parentage?.parentThreadId).toBe('middle-thread')
    expect(origin?.parentage?.agentRole).toBe('explorer')
  })

  it('keeps the rest of the spawn when the naming path is null', () => {
    const origin = readCodexSubagentOrigin(
      spawnedPayload({
        parent_thread_id: 'user-thread',
        depth: 1,
        agent_path: null,
        agent_nickname: 'Laplace',
        agent_role: 'explorer'
      })
    )

    expect(origin?.parentage).toEqual({
      parentThreadId: 'user-thread',
      depth: 1,
      agentNickname: 'Laplace',
      agentRole: 'explorer',
      agentPath: null
    })
  })

  it('reads the agent_type spelling of the role, nested and on the payload', () => {
    // Codex documents `agent_type` as an alias of `agent_role` in both places.
    expect(readCodexSubagentOrigin(spawnedPayload({ agent_type: 'explorer' }))?.parentage).toEqual({
      parentThreadId: null,
      depth: null,
      agentNickname: null,
      agentRole: 'explorer',
      agentPath: null
    })
    expect(
      readCodexSubagentOrigin(spawnedPayload({}, { agent_type: 'reviewer' }))?.parentage?.agentRole
    ).toBe('reviewer')
  })

  it('reads the role the payload copied beside the spawn record', () => {
    expect(
      readCodexSubagentOrigin(spawnedPayload({}, { agent_role: 'explorer' }))?.parentage?.agentRole
    ).toBe('explorer')
  })

  it('classifies a non-spawn thread by its tag instead of calling it a role', () => {
    // `review`, `compact` and `memory_consolidation` are sibling tags naming the
    // sort of non-user thread. They are not the spawned agent's role — that
    // field exists only inside a spawn record — and the parent, when there is
    // one, is stated on the payload's own key.
    const origin = readCodexSubagentOrigin({
      id: 'child-thread',
      thread_source: 'subagent',
      source: { subagent: 'review' },
      parent_thread_id: '019f49cb-7af8-7e01-946a-274c65fe6103'
    })

    expect(origin).toEqual({
      kind: 'review',
      kindLabel: null,
      threadSource: 'subagent',
      parentage: {
        parentThreadId: '019f49cb-7af8-7e01-946a-274c65fe6103',
        depth: null,
        agentNickname: null,
        agentRole: null,
        agentPath: null
      }
    })
  })

  it('classifies a compaction thread that states no parent at all', () => {
    expect(
      readCodexSubagentOrigin({ id: 'child-thread', source: { subagent: 'compact' } })
    ).toEqual({ kind: 'compact', kindLabel: null, threadSource: null, parentage: null })
    expect(
      readCodexSubagentOrigin({ id: 'child-thread', source: { subagent: 'memory_consolidation' } })
        ?.kind
    ).toBe('memory_consolidation')
  })

  it('keeps the label of a tag that carries free text', () => {
    expect(
      readCodexSubagentOrigin({ id: 'child-thread', source: { subagent: { other: 'gardener' } } })
    ).toEqual({ kind: 'other', kindLabel: 'gardener', threadSource: null, parentage: null })
  })

  it('degrades field by field when a spawn record is malformed', () => {
    const origin = readCodexSubagentOrigin(
      spawnedPayload({
        parent_thread_id: 12345,
        agent_nickname: 'Mendel',
        agent_role: 'explorer'
      })
    )

    // The unreadable parent and the absent depth do not cost the two fields the
    // record does state.
    expect(origin?.parentage).toEqual({
      parentThreadId: null,
      depth: null,
      agentNickname: 'Mendel',
      agentRole: 'explorer',
      agentPath: null
    })
  })

  it('rejects a depth that contradicts being a child', () => {
    expect(readCodexSubagentOrigin(spawnedPayload({ depth: 0 }))?.parentage).toBeNull()
    expect(readCodexSubagentOrigin(spawnedPayload({ depth: 1.5 }))?.parentage).toBeNull()
    expect(readCodexSubagentOrigin(spawnedPayload({ depth: '2' }))?.parentage).toBeNull()
  })

  it('still reports the origin when no part of the spawn is readable', () => {
    const origin = readCodexSubagentOrigin(spawnedPayload(true))

    expect(origin).toEqual({
      kind: 'thread_spawn',
      kindLabel: null,
      threadSource: 'subagent',
      parentage: null
    })
  })

  it('reports a subagent source that states no spawn at all', () => {
    const origin = readCodexSubagentOrigin({
      id: 'child-thread',
      source: { subagent: { thread_spawn: null } }
    })

    expect(origin).toEqual({
      kind: 'thread_spawn',
      kindLabel: null,
      threadSource: null,
      parentage: null
    })
  })

  it('reads no origin from a user thread', () => {
    expect(
      readCodexSubagentOrigin({ id: 'user-thread', thread_source: 'user', source: 'cli' })
    ).toBeNull()
    expect(readCodexSubagentOrigin({ id: 'user-thread', source: 'vscode' })).toBeNull()
    expect(readCodexSubagentOrigin({ id: 'user-thread' })).toBeNull()
  })

  it('keeps a thread whose only subagent signal states no readable tag', () => {
    // A tagged union spells a tag as a bare string or a single-key object, so
    // none of these is one. Reading one as a spawn would drop the user's own
    // thread out of their history on nothing but a key that happens to exist.
    for (const subagent of [false, true, 0, 1, '', '   ', [], {}, { a: 1, b: 2 }]) {
      expect(readCodexSubagentOrigin({ id: 'user-thread', source: { subagent } })).toBeNull()
    }
  })

  it('keeps a forked user thread, whose lineage is not a spawn parent', () => {
    // `forked_from_id` and `parent_thread_id` are separate co-existing keys
    // meaning different things. A forked thread is still the user's own.
    expect(
      readCodexSubagentOrigin({
        id: 'user-thread',
        thread_source: 'user',
        forked_from_id: '019f49cb-7af8-7e01-946a-274c65fe6103'
      })
    ).toBeNull()
    expect(
      readCodexSubagentOrigin({
        id: 'user-thread',
        forked_from_id: '019f49cb-7af8-7e01-946a-274c65fe6103'
      })
    ).toBeNull()
  })

  it('lets a stated user thread_source outrank a subagent source', () => {
    expect(
      readCodexSubagentOrigin({
        id: 'user-thread',
        thread_source: 'user',
        source: { subagent: { thread_spawn: { parent_thread_id: 'other' } } }
      })
    ).toBeNull()
  })

  it('reads the camelCase thread_source spelling', () => {
    expect(readCodexSubagentOrigin({ id: 'child', threadSource: 'agent' })).toEqual({
      kind: null,
      kindLabel: null,
      threadSource: 'agent',
      parentage: null
    })
  })
})
