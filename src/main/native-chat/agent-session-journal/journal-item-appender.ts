import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity
} from '../../../shared/agent-session-journal-types'
import { journalItemRowBuilder } from './journal-row-builders'
import type { JournalReducerState } from './journal-reducer'
import type { JournalAppendResult, JournalOrderedAppendResult } from './journal-store-contracts'
import type { JournalRow } from './journal-row-schema'

type ItemAppendOptions = { fence: number; observedAt?: number; recovered?: true }

export class JournalItemAppender {
  constructor(
    private readonly deps: {
      state: () => JournalReducerState
      enqueue: (build: (seq: number, ts: number) => JournalRow) => Promise<JournalRow>
    }
  ) {}

  append(
    identity: AgentJournalItemIdentity,
    body: AgentJournalItemBody,
    options: ItemAppendOptions,
    capturePrecedingPendingSubmissions: () => string[]
  ): Promise<JournalOrderedAppendResult<JournalAppendResult>> {
    const itemId = agentJournalItemKey(identity)
    let precedingPendingSubmissionIds: string[] = []
    const build = journalItemRowBuilder(this.deps.state, identity, body, options)
    return this.deps
      .enqueue((seq, ts) => {
        precedingPendingSubmissionIds = capturePrecedingPendingSubmissions()
        return build(seq, ts)
      })
      .then((row) => {
        if (row.kind !== 'item') {
          throw new Error('journal_item_append_returned_non_item_row')
        }
        return {
          value: {
            cursor: { epoch: row.epoch, sequence: row.seq },
            itemId,
            revision: row.revision
          },
          appended: true,
          precedingPendingSubmissionIds
        }
      })
  }
}
