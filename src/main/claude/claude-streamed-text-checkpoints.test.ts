import { describe, expect, it } from 'vitest'
import type { AgentJournalItemIdentity } from '../../shared/agent-session-journal-types'
import type { StructuredAgentSessionAppendOptions } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { createClaudeStreamedTextCheckpoints } from './claude-streamed-text-checkpoints'
import type { ClaudeSubagentLinkageSource } from './claude-subagent-linkage'

function identityOf(uuid: string): AgentJournalItemIdentity {
  return { provider: 'claude', sessionId: 'claude-session', uuid }
}

/** Every block is the session's own agent's unless a test says otherwise. */
const rootProducer: ClaudeSubagentLinkageSource = {
  linkageFor: () => ({ kind: 'root' }),
  settledLinkageFor: () => ({ kind: 'root' })
}

function checkpoints(producer: ClaudeSubagentLinkageSource = rootProducer) {
  const rows: { uuid: string; text: string }[] = []
  /** Attribution kept beside the rows rather than on them, so the assertions
   *  about text stay about text — and so a harness that dropped the argument
   *  would show up as an empty list rather than as silence. */
  const stamps: StructuredAgentSessionAppendOptions[] = []
  let scheduled: (() => void) | null = null
  const store = createClaudeStreamedTextCheckpoints({
    producer,
    persist: (identity, text, options) => {
      rows.push({ uuid: 'uuid' in identity ? identity.uuid : '', text })
      stamps.push(options)
    },
    schedule: (run) => {
      scheduled = run
      return () => {
        scheduled = null
      }
    }
  })
  return {
    store,
    rows,
    stamps,
    runWindow: () => {
      const run = scheduled as (() => void) | null
      run?.()
    }
  }
}

describe('claude streamed text checkpoints', () => {
  it('rewrites a block row with the full text accumulated so far', () => {
    const { store, rows, runWindow } = checkpoints()

    store.append(identityOf('block-1'), 'hel')
    store.append(identityOf('block-1'), 'lo')
    runWindow()

    expect(rows).toEqual([{ uuid: 'block-1', text: 'hello' }])
    expect(store.pending).toBe(1)
  })

  it('drops every block still awaiting its final frame at settlement', () => {
    const { store, rows, runWindow } = checkpoints()

    store.append(identityOf('block-1'), 'partial answer')
    runWindow()
    store.settle()

    expect(store.pending).toBe(0)
    // The row written before settlement stays; nothing is rewritten afterwards.
    store.flush()
    expect(rows).toEqual([{ uuid: 'block-1', text: 'partial answer' }])
  })

  it('keeps a block whose final frame arrived out of the settlement sweep', () => {
    const { store } = checkpoints()

    store.append(identityOf('block-1'), 'one')
    store.append(identityOf('block-2'), 'two')
    store.forget('claude:claude-session:block-1')

    expect(store.pending).toBe(1)
    store.settle()
    expect(store.pending).toBe(0)
  })

  it('flushes text the widening checkpoint interval has not written yet', () => {
    const { store, rows } = checkpoints()

    store.append(identityOf('block-1'), 'x')
    store.flush()

    expect(rows).toEqual([{ uuid: 'block-1', text: 'x' }])
    // Already at the row's length: a second flush has nothing to write.
    store.flush()
    expect(rows).toHaveLength(1)
  })

  it('stops persisting once disposed', () => {
    const { store, rows, runWindow } = checkpoints()

    store.append(identityOf('block-1'), 'text')
    store.dispose()
    runWindow()
    store.flush()

    expect(rows).toEqual([])
    expect(store.pending).toBe(0)
  })
})
