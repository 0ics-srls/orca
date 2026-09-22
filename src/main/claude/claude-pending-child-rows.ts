// Child rows held back until the agent that produced them has a final identity.
//
// A subagent's first frames can arrive before the `task_started` that names it.
// At that moment the only handle is the spawn call's `tool_use_id`, which is
// re-minted on the next resume — so a row stamped with it splits one child into
// two, permanently, because the journal is the durable record and has no
// backfill. Holding the row until the announcement lands is what makes the
// stamped identity resume-safe.
//
// What this must never do is swallow. A parked row leaves here by exactly one
// of three doors — the announcement arrives, the buffer is full, or nothing can
// resolve it any more — and every one of them writes the row.

import { agentJournalLinkageFields } from '../../shared/agent-session-journal-producer'
import type { AgentJournalProducerLinkage } from '../../shared/agent-session-journal-types'
import type { StructuredAgentSessionAppendOptions } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import type { ClaudeSubagentLinkageSource } from './claude-subagent-linkage'

/**
 * How every Claude journal write states who produced it.
 *
 * A write site hands over the row it wants written and is handed back the sink
 * options that attribute it. The session's own rows run the callback straight
 * away with nothing added; a child's may wait for its agent's identity first.
 * No site chooses — the envelope it came from already decided.
 */
export type ClaudeRowAdmission = (
  write: (options: StructuredAgentSessionAppendOptions) => void
) => void

/** The session's own agent wrote this row: nothing is stamped, nothing waits. */
export const rootClaudeRowAdmission: ClaudeRowAdmission = (write) => write({})

/** Rows held at once, oldest written first when the bound is reached. Deep
 *  enough to cover an announcement in flight, shallow enough that a release
 *  that never comes costs a bounded delay rather than a whole turn of output. */
const MAX_PENDING_CHILD_ROWS = 64

export type ClaudePendingChildRowsDeps = ClaudeSubagentLinkageSource

/** Writes one held row. `undefined` linkage means the row is the session's own. */
type ParkedWrite = (linkage: AgentJournalProducerLinkage | undefined) => void

export class ClaudePendingChildRows {
  /** Insertion-ordered, so a child's own rows are written in the order the
   *  provider sent them however long they waited. */
  private readonly parked: { ref: string; write: ParkedWrite }[] = []

  constructor(private readonly deps: ClaudePendingChildRowsDeps) {}

  get pending(): number {
    return this.parked.length
  }

  /** How rows from one envelope are attributed. A null reference is the
   *  session's own agent; anything else is a child of it. */
  admissionFor(parentToolUseId: string | null): ClaudeRowAdmission {
    if (parentToolUseId === null) {
      return rootClaudeRowAdmission
    }
    return (write) =>
      this.admit(parentToolUseId, (linkage) => write(agentJournalLinkageFields(linkage)))
  }

  /** Write the row now if its producer's identity is final; hold it otherwise. */
  private admit(parentToolUseId: string, write: ParkedWrite): void {
    const verdict = this.deps.linkageFor(parentToolUseId)
    // A row for a ref that already has rows waiting goes behind them whatever
    // the verdict says, or the child's output would be written out of order.
    if (verdict.kind !== 'pending' && !this.parked.some((row) => row.ref === parentToolUseId)) {
      write(verdict.kind === 'linked' ? verdict.linkage : undefined)
      return
    }
    this.parked.push({ ref: parentToolUseId, write })
    while (this.parked.length > MAX_PENDING_CHILD_ROWS) {
      const evicted = this.parked.shift()
      if (!evicted) {
        break
      }
      this.write(evicted)
    }
  }

  /** Re-resolve every held row and write those whose identity is now final.
   *  Rows still waiting on their own announcement stay in order behind it. */
  retry(): void {
    const stillPending = new Set<string>()
    for (const row of this.parked.splice(0)) {
      const verdict = stillPending.has(row.ref)
        ? ({ kind: 'pending' } as const)
        : this.deps.linkageFor(row.ref)
      if (verdict.kind === 'pending') {
        stillPending.add(row.ref)
        this.parked.push(row)
        continue
      }
      row.write(verdict.kind === 'linked' ? verdict.linkage : undefined)
    }
  }

  /** Nothing further can name these producers. Write every held row. */
  drain(): void {
    for (const row of this.parked.splice(0)) {
      this.write(row)
    }
  }

  private write(row: { ref: string; write: ParkedWrite }): void {
    const verdict = this.deps.settledLinkageFor(row.ref)
    row.write(verdict.kind === 'linked' ? verdict.linkage : undefined)
  }
}
