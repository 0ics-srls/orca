import type { AgentJournalCursor } from '../../../shared/agent-session-journal-types'
import type { JournalReducerState } from './journal-reducer'
import { journalLifecycleBatchRowBuilder } from './journal-row-builders'
import type {
  JournalLifecycleBatchInput,
  JournalOrderedAppendResult
} from './journal-store-contracts'
import type { JournalRow } from './journal-row-schema'

const SETTLEMENT_ALREADY_APPLIED = new Error('journal_settlement_already_applied')

export class JournalLifecycleBatchAppender {
  constructor(
    private readonly deps: {
      state: () => JournalReducerState
      cursor: () => AgentJournalCursor
      enqueue: (build: (seq: number, ts: number) => JournalRow) => Promise<JournalRow>
    }
  ) {}

  append(
    input: JournalLifecycleBatchInput,
    capturePrecedingPendingSubmissions: () => string[]
  ): Promise<JournalOrderedAppendResult<AgentJournalCursor>> {
    if (this.wasApplied(input.settlementId)) {
      return Promise.resolve({
        value: this.deps.cursor(),
        appended: false,
        precedingPendingSubmissionIds: []
      })
    }
    let precedingPendingSubmissionIds: string[] = []
    const build = journalLifecycleBatchRowBuilder(
      this.deps.state,
      input.settlementId,
      input.mutations,
      input
    )
    return this.deps
      .enqueue((seq, ts) => {
        if (this.wasApplied(input.settlementId)) {
          throw SETTLEMENT_ALREADY_APPLIED
        }
        precedingPendingSubmissionIds = capturePrecedingPendingSubmissions()
        return build(seq, ts)
      })
      .then((row) => ({
        value: { epoch: row.epoch, sequence: row.seq },
        appended: true,
        precedingPendingSubmissionIds
      }))
      .catch((error: unknown) => {
        if (error === SETTLEMENT_ALREADY_APPLIED) {
          return {
            value: this.deps.cursor(),
            appended: false,
            precedingPendingSubmissionIds: []
          }
        }
        throw error
      })
  }

  private wasApplied(settlementId: string): boolean {
    return this.deps.state().appliedSettlementIds.has(settlementId)
  }
}
