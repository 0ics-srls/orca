// Atomic, once-per-epoch migrations over a journal's reduced item state.

import type Database from '../../sqlite/sync-database'
import {
  journalEpochMigrationWasApplied,
  recordJournalEpochMigration
} from './journal-epoch-migration-marker'
import { applyJournalRow, type JournalReducerState } from './journal-reducer'
import { journalLifecycleBatchRowBuilder } from './journal-row-builders'
import { insertJournalRow, upsertJournalSessionRow } from './journal-row-table'
import { partitionJournalLifecycleMutations } from './journal-lifecycle-batch-partition'
import type {
  JournalEpochMigrationResult,
  JournalEpochTombstoneMigrationInput
} from './journal-store-contracts'
import type { JournalRow } from './journal-row-schema'
import { assertJournalFence, assertJournalWritable } from './journal-write-guards'

export class JournalEpochMigrationRunner {
  constructor(
    private readonly deps: {
      sessionId: string
      now: () => number
      serialize: <T>(run: () => Promise<T>) => Promise<T>
      database: () => { db: Database.Database }
      state: () => JournalReducerState
      readOnly: () => boolean
      commit: (row: JournalRow) => void
    }
  ) {}

  run(input: JournalEpochTombstoneMigrationInput): Promise<JournalEpochMigrationResult> {
    if (this.deps.readOnly()) {
      return Promise.resolve({ applied: false, tombstonedItems: 0 })
    }
    return this.deps.serialize(async () => {
      assertJournalWritable(this.deps.readOnly(), this.deps.sessionId)
      const state = this.deps.state()
      const { db } = this.deps.database()
      const rows: JournalRow[] = []
      let tombstonedItems = 0
      db.exec('BEGIN IMMEDIATE')
      try {
        if (
          journalEpochMigrationWasApplied(db, this.deps.sessionId, state.epoch, input.migrationId)
        ) {
          db.exec('COMMIT')
          return { applied: false, tombstonedItems: 0 }
        }
        const mutations = [...state.items.values()].flatMap((item) => {
          const identity = input.selectIdentity(item)
          return identity ? [{ kind: 'tombstone' as const, identity }] : []
        })
        tombstonedItems = mutations.length
        const staged = cloneTombstoneMigrationState(state)
        for (const chunk of partitionJournalLifecycleMutations(input.settlementId, mutations)) {
          const row = journalLifecycleBatchRowBuilder(
            () => staged,
            chunk.settlementId,
            chunk.mutations,
            { fence: input.fence, ...(input.recovered ? { recovered: true } : {}) }
          )(staged.lastSequence + 1, this.deps.now())
          assertJournalFence(row.fence, staged.highestFence)
          insertJournalRow(db, this.deps.sessionId, row)
          upsertJournalSessionRow(db, this.deps.sessionId, row.epoch, row.ts)
          applyJournalRow(staged, row)
          rows.push(row)
        }
        recordJournalEpochMigration(db, {
          sessionId: this.deps.sessionId,
          epoch: state.epoch,
          migrationId: input.migrationId,
          appliedAt: this.deps.now()
        })
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      for (const row of rows) {
        this.deps.commit(row)
      }
      return { applied: true, tombstonedItems }
    })
  }
}

function cloneTombstoneMigrationState(state: JournalReducerState): JournalReducerState {
  return {
    ...state,
    items: new Map(state.items),
    tombstones: new Map(state.tombstones),
    submissions: new Map(state.submissions),
    receipts: new Map(state.receipts),
    aliases: new Map(state.aliases),
    appliedSettlementIds: new Set(state.appliedSettlementIds)
  }
}
