import { describe, expect, it } from 'vitest'
import {
  schemaLockTarget,
  sqlWithoutLeadingComments,
  takesRelationLock
} from './schema-lock-target.js'

// The shape a schema string split on ';' actually produces: the comment written above a statement
// arrives glued to the front of it.
const COMMENTED_INDEX = `-- Why: the maintenance sweep matches (active, deadline) while inactive
-- bases accumulate unboundedly.
CREATE INDEX IF NOT EXISTS relay_connection_bases_active_deadline
  ON relay_connection_bases(active, deadline)`

const COMMENTED_TABLE = `-- Rehoming is bidirectional, but tables created before that carry the
-- original single-region column check.
CREATE TABLE IF NOT EXISTS relay_cells (
  cell_id TEXT PRIMARY KEY
)`

describe('sqlWithoutLeadingComments', () => {
  it('strips the line comments a split schema glues above a statement', () => {
    expect(sqlWithoutLeadingComments(COMMENTED_INDEX)).toMatch(/^CREATE INDEX IF NOT EXISTS/)
  })

  it('strips a leading block comment', () => {
    expect(sqlWithoutLeadingComments('/* note */\n  ALTER TABLE t ADD COLUMN c TEXT')).toBe(
      'ALTER TABLE t ADD COLUMN c TEXT'
    )
  })

  it('leaves a trailing comment alone', () => {
    expect(sqlWithoutLeadingComments('SELECT 1 -- note')).toBe('SELECT 1 -- note')
  })
})

describe('takesRelationLock', () => {
  it('classifies a comment-prefixed CREATE INDEX by its first SQL keyword', () => {
    expect(takesRelationLock(COMMENTED_INDEX)).toBe(true)
  })

  it('classifies a comment-prefixed CREATE TABLE as taking no relation lock', () => {
    expect(takesRelationLock(COMMENTED_TABLE)).toBe(false)
  })

  it('counts every ALTER TABLE, including the constraint swaps', () => {
    expect(takesRelationLock('ALTER TABLE t DROP CONSTRAINT IF EXISTS c')).toBe(true)
  })
})

describe('schemaLockTarget', () => {
  it('derives an index target through the comments above it', () => {
    expect(schemaLockTarget(COMMENTED_INDEX)).toEqual({
      kind: 'index',
      table: 'relay_connection_bases',
      name: 'relay_connection_bases_active_deadline'
    })
  })

  it('derives an index target across the line break before ON', () => {
    expect(
      schemaLockTarget(`CREATE INDEX IF NOT EXISTS relay_reservation_assignment
  ON relay_control_connection_reservations(
    user_id, relay_host_id
  )`)
    ).toEqual({
      kind: 'index',
      table: 'relay_control_connection_reservations',
      name: 'relay_reservation_assignment'
    })
  })

  it('derives a unique concurrent index target', () => {
    expect(schemaLockTarget('CREATE UNIQUE INDEX CONCURRENTLY i ON t(c)')).toEqual({
      kind: 'index',
      table: 't',
      name: 'i'
    })
  })

  it('keeps the schema qualification on the table and drops it from the object name', () => {
    // `table` is fed to to_regclass, which needs the qualification; `name` is matched against
    // relname, which stores the bare identifier.
    expect(schemaLockTarget('CREATE INDEX IF NOT EXISTS app.i ON app.t(c)')).toEqual({
      kind: 'index',
      table: 'app.t',
      name: 'i'
    })
  })

  it('unquotes a quoted identifier, doubled quote included', () => {
    expect(schemaLockTarget('CREATE INDEX IF NOT EXISTS "od""d" ON "My Table"(c)')).toEqual({
      kind: 'index',
      table: '"My Table"',
      name: 'od"d'
    })
  })

  it('derives a column target from a multi-line ADD COLUMN IF NOT EXISTS', () => {
    expect(
      schemaLockTarget(`ALTER TABLE relay_region_rehome_control
     ADD COLUMN IF NOT EXISTS host_cooldown_ms BIGINT NOT NULL
     DEFAULT 604800000`)
    ).toEqual({ kind: 'column', table: 'relay_region_rehome_control', name: 'host_cooldown_ms' })
  })

  it('derives a column target without IF NOT EXISTS', () => {
    expect(schemaLockTarget('ALTER TABLE ONLY t ADD COLUMN c TEXT')).toEqual({
      kind: 'column',
      table: 't',
      name: 'c'
    })
  })

  it('gives a constraint swap no target', () => {
    // pg_constraint is a different lookup; these statements stay unchecked and the census pins them.
    expect(schemaLockTarget('ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0)')).toBeUndefined()
    expect(schemaLockTarget('ALTER TABLE t DROP CONSTRAINT IF EXISTS c')).toBeUndefined()
  })

  it('gives CREATE TABLE IF NOT EXISTS no target', () => {
    expect(schemaLockTarget(COMMENTED_TABLE)).toBeUndefined()
  })
})
