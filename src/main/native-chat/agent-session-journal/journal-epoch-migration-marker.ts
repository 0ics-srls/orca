// Durable, epoch-scoped completion markers for journal data migrations.

import type Database from '../../sqlite/sync-database'

const SELECT_MARKER = `SELECT 1 AS applied FROM journal_epoch_migrations
WHERE session_id = ? AND epoch = ? AND migration_id = ?`
const INSERT_MARKER = `INSERT INTO journal_epoch_migrations
(session_id, epoch, migration_id, applied_at) VALUES (?, ?, ?, ?)`
const DELETE_SESSION_MARKERS = 'DELETE FROM journal_epoch_migrations WHERE session_id = ?'

export function journalEpochMigrationWasApplied(
  db: Database.Database,
  sessionId: string,
  epoch: string,
  migrationId: string
): boolean {
  return db.prepare(SELECT_MARKER).get(sessionId, epoch, migrationId) !== undefined
}

export function recordJournalEpochMigration(
  db: Database.Database,
  input: { sessionId: string; epoch: string; migrationId: string; appliedAt: number }
): void {
  db.prepare(INSERT_MARKER).run(input.sessionId, input.epoch, input.migrationId, input.appliedAt)
}

export function clearJournalEpochMigrations(db: Database.Database, sessionId: string): void {
  db.prepare(DELETE_SESSION_MARKERS).run(sessionId)
}
