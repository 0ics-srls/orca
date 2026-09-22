import { describe, expect, it } from 'vitest'
import type { StructuredAgentSessionAppendOptions } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { ClaudePendingChildRows } from './claude-pending-child-rows'
import type { ClaudeSubagentLinkageVerdict } from './claude-subagent-linkage'

/** A stand-in roster whose verdict a test moves between frames. */
function producer(initial: Record<string, ClaudeSubagentLinkageVerdict> = {}) {
  const verdicts = new Map(Object.entries(initial))
  return {
    set: (ref: string, verdict: ClaudeSubagentLinkageVerdict) => verdicts.set(ref, verdict),
    source: {
      linkageFor: (ref: string): ClaudeSubagentLinkageVerdict =>
        verdicts.get(ref) ?? { kind: 'pending' },
      settledLinkageFor: (ref: string) => {
        const verdict = verdicts.get(ref)
        return verdict && verdict.kind !== 'pending'
          ? verdict
          : ({
              kind: 'linked',
              linkage: { agentId: ref, providerParentRef: ref, producerKind: 'agent' }
            } as const)
      }
    }
  }
}

function linked(agentId: string): ClaudeSubagentLinkageVerdict {
  return {
    kind: 'linked',
    linkage: { agentId, providerParentRef: 'toolu_1', producerKind: 'agent' }
  }
}

describe('ClaudePendingChildRows', () => {
  it("writes the session's own rows straight through", () => {
    const written: StructuredAgentSessionAppendOptions[] = []
    const rows = new ClaudePendingChildRows(producer().source)
    rows.admissionFor(null)((options) => written.push(options))
    expect(written).toEqual([{}])
    expect(rows.pending).toBe(0)
  })

  it('holds a row whose producer is still provisional, then writes it linked', () => {
    const written: StructuredAgentSessionAppendOptions[] = []
    const roster = producer()
    const rows = new ClaudePendingChildRows(roster.source)

    rows.admissionFor('toolu_1')((options) => written.push(options))
    expect(written).toEqual([])
    expect(rows.pending).toBe(1)

    roster.set('toolu_1', linked('task-1'))
    rows.retry()

    expect(written).toEqual([
      { agentId: 'task-1', providerParentRef: 'toolu_1', producerKind: 'agent' }
    ])
    expect(rows.pending).toBe(0)
  })

  it('keeps one child’s rows in the order the provider sent them', () => {
    // A row admitted while earlier ones for the same child are still held goes
    // behind them even though its own verdict has landed, or the child's output
    // would be journaled out of order.
    const written: string[] = []
    const roster = producer()
    const rows = new ClaudePendingChildRows(roster.source)

    rows.admissionFor('toolu_1')(() => written.push('first'))
    roster.set('toolu_1', linked('task-1'))
    rows.admissionFor('toolu_1')(() => written.push('second'))
    rows.retry()

    expect(written).toEqual(['first', 'second'])
  })

  it('writes the oldest held row rather than dropping it when the bound is reached', () => {
    // Anti-swallow. A held row leaves by one of three doors and every one of
    // them writes it; the bound is a delay, never a loss.
    const written: StructuredAgentSessionAppendOptions[] = []
    const rows = new ClaudePendingChildRows(producer().source)

    for (let index = 0; index < 65; index += 1) {
      rows.admissionFor('toolu_1')((options) => written.push(options))
    }

    expect(written).toHaveLength(1)
    expect(written[0]).toEqual({
      agentId: 'toolu_1',
      providerParentRef: 'toolu_1',
      producerKind: 'agent'
    })
    expect(rows.pending).toBe(64)
  })

  it('writes every held row when nothing can name its producer any more', () => {
    const written: StructuredAgentSessionAppendOptions[] = []
    const rows = new ClaudePendingChildRows(producer().source)

    rows.admissionFor('toolu_1')((options) => written.push(options))
    rows.admissionFor('toolu_2')((options) => written.push(options))
    expect(written).toEqual([])

    rows.drain()

    // Written under the only handle there was, and still as a child's — never
    // as the parent's, which is the invariant the delay exists to protect.
    expect(written.map((options) => options.agentId)).toEqual(['toolu_1', 'toolu_2'])
    expect(rows.pending).toBe(0)
  })

  it('writes a held row with no linkage when its release says the row is root', () => {
    const written: StructuredAgentSessionAppendOptions[] = []
    const roster = producer()
    const rows = new ClaudePendingChildRows(roster.source)

    rows.admissionFor('toolu_1')((options) => written.push(options))
    roster.set('toolu_1', { kind: 'root' })
    rows.retry()

    expect(written).toEqual([{}])
  })
})
