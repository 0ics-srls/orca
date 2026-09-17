import { describe, expect, it } from 'vitest'
import {
  schemaLockTarget,
  sqlWithoutLeadingComments,
  takesRelationLock,
  type SchemaLockTarget
} from '@orca-cloud/postgres-schema'
import { relayPostgresSchemaStatements } from './database.js'

// Golden pin of every boot-time statement that takes a relation lock on Postgres. Each entry with
// a kind is gated by the catalog pre-check, so it costs a catalog read on a migrated database and
// nothing more. An addition to this list is the case the RULE comment beside SCHEMA forbids: a
// brand-new index reports missing on every director at once and each one runs a non-concurrent
// build over the whole table, which is how a boot takes the site down. Build it out of band with
// CREATE INDEX CONCURRENTLY first, then add it to SCHEMA and update this list.
const GOLDEN_LOCK_TAKING: (SchemaLockTarget | { unchecked: string })[] = [
  { kind: 'index', table: 'relay_invites', name: 'relay_invites_device' },
  { kind: 'index', table: 'relay_devices', name: 'relay_devices_current_hash' },
  { kind: 'index', table: 'relay_devices', name: 'relay_devices_grace_hash' },
  { kind: 'index', table: 'relay_connection_bases', name: 'relay_connection_bases_active_deadline' },
  {
    kind: 'index',
    table: 'relay_assignment_region_preferences',
    name: 'relay_assignment_region_preferences_observed'
  },
  {
    kind: 'index',
    table: 'relay_region_rehome_attempts',
    name: 'relay_region_rehome_attempts_pending'
  },
  {
    kind: 'index',
    table: 'relay_region_rehome_attempts',
    name: 'relay_region_rehome_attempts_host_recency'
  },
  { kind: 'index', table: 'relay_cell_runtime', name: 'relay_cell_runtime_heartbeat' },
  {
    kind: 'index',
    table: 'relay_cell_connection_runtime',
    name: 'relay_cell_connection_runtime_heartbeat'
  },
  {
    kind: 'index',
    table: 'relay_cell_connection_snapshots',
    name: 'relay_cell_connection_snapshot_freshness'
  },
  { kind: 'index', table: 'relay_cell_fences', name: 'relay_cell_fences_expiry' },
  { kind: 'index', table: 'relay_cell_committed_fences', name: 'relay_cell_committed_fences_expiry' },
  {
    kind: 'index',
    table: 'relay_cell_legacy_fence_adoptions',
    name: 'relay_cell_legacy_fence_adoptions_expiry'
  },
  { kind: 'index', table: 'relay_cell_fence_attempts', name: 'relay_cell_fence_attempts_expiry' },
  { kind: 'index', table: 'relay_cell_fence_attempts', name: 'relay_cell_fence_attempts_cell' },
  {
    kind: 'index',
    table: 'relay_cell_fence_apply_invocations',
    name: 'relay_cell_fence_apply_invocations_attempt'
  },
  {
    kind: 'index',
    table: 'relay_cell_drain_attempt_states',
    name: 'relay_cell_drain_attempt_states_cell'
  },
  {
    kind: 'index',
    table: 'relay_assignment_activity_leases',
    name: 'relay_assignment_activity_expiry'
  },
  {
    kind: 'index',
    table: 'relay_control_connection_reservations',
    name: 'relay_control_connection_reservation_headroom'
  },
  {
    kind: 'index',
    table: 'relay_control_connection_reservations',
    name: 'relay_control_connection_reservation_assignment'
  },
  { kind: 'index', table: 'relay_assignment_migrations', name: 'relay_assignment_migrations_active' },
  {
    kind: 'index',
    table: 'relay_post_drain_migration_pins',
    name: 'relay_post_drain_migration_pins_attempt'
  },
  { kind: 'index', table: 'relay_audit_events', name: 'relay_audit_events_at' },
  { kind: 'column', table: 'relay_region_decisions', name: 'last_considered_at' },
  { kind: 'column', table: 'relay_region_decisions', name: 'cohort_bucket' },
  // Constraint swaps look up pg_constraint, not pg_class or pg_attribute, so the pre-check has no
  // answer for them and they still take ACCESS EXCLUSIVE on every boot. Both are cheap on
  // relay_region_rehome_attempts today and both are pinned here so a third one cannot slip in.
  {
    unchecked:
      'DROP CONSTRAINT relay_region_rehome_attempts.relay_region_rehome_attempts_preferred_region_check'
  },
  {
    unchecked:
      'ADD CONSTRAINT relay_region_rehome_attempts.relay_region_rehome_attempts_preferred_region_valid'
  },
  { kind: 'column', table: 'relay_region_rehome_control', name: 'host_cooldown_ms' },
  { kind: 'column', table: 'relay_control_capabilities', name: 'idle_regional_rehome' },
  { kind: 'column', table: 'relay_region_rehome_attempts', name: 'source_generation' }
]

const INDEX_OR_ADD_COLUMN = /^(?:CREATE\s+(?:UNIQUE\s+)?INDEX|ALTER\s+TABLE\s+[^\s]+\s+ADD\s+COLUMN)/i

const CONSTRAINT_SWAP =
  /^ALTER\s+TABLE\s+(\S+)\s+(ADD|DROP)\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\S+)/i

// A constraint swap is pinned by the constraint it names, not by its body: the CHECK list is
// generated from RELAY_REGIONS, and adding a region must not have to touch this golden. Anything
// else unchecked falls back to its whole text, so a new shape fails here loudly.
function uncheckedIdentity(statement: string): string {
  const collapsed = sqlWithoutLeadingComments(statement).replace(/\s+/g, ' ').trim()
  const swap = CONSTRAINT_SWAP.exec(collapsed)
  return swap ? `${swap[2]!.toUpperCase()} CONSTRAINT ${swap[1]}.${swap[3]}` : collapsed
}

function lockTakingStatements(): string[] {
  return relayPostgresSchemaStatements().filter(takesRelationLock)
}

describe('relay boot-time lock targets', () => {
  it('matches the pinned list of lock-taking statements', () => {
    expect(
      lockTakingStatements().map(
        (statement) => schemaLockTarget(statement) ?? { unchecked: uncheckedIdentity(statement) }
      )
    ).toEqual(GOLDEN_LOCK_TAKING)
  })

  it('derives a target for every CREATE INDEX and every ALTER TABLE ADD COLUMN', () => {
    // A census over the real schema, not two hand-picked cases: a statement that lands here
    // without a target is sent on every boot and takes the lock the pre-check exists to avoid.
    const unparsed = relayPostgresSchemaStatements().filter(
      (statement) =>
        INDEX_OR_ADD_COLUMN.test(sqlWithoutLeadingComments(statement)) &&
        schemaLockTarget(statement) === undefined
    )
    expect(unparsed).toEqual([])
  })

  it('pre-checks every lock-taking statement except the two pinned constraint swaps', () => {
    const unchecked = lockTakingStatements().filter(
      (statement) => schemaLockTarget(statement) === undefined
    )
    expect(unchecked).toHaveLength(2)
  })

  it('derives a target through the comment block a split schema glues on', () => {
    // Not vacuous: SCHEMA really does carry a comment-prefixed statement, and it is a CREATE INDEX
    // on relay_connection_bases. Classifying the raw text would give it no target at all.
    const commented = relayPostgresSchemaStatements().filter((statement) =>
      statement.startsWith('--')
    )
    expect(commented.length).toBeGreaterThan(0)
    for (const statement of commented) {
      if (!takesRelationLock(statement)) continue
      expect(schemaLockTarget(statement)).toBeDefined()
    }
    expect(commented.map(schemaLockTarget)).toContainEqual({
      kind: 'index',
      table: 'relay_connection_bases',
      name: 'relay_connection_bases_active_deadline'
    })
  })

  it('leaves every statement classifiable once its leading comments are stripped', () => {
    for (const statement of relayPostgresSchemaStatements()) {
      expect(sqlWithoutLeadingComments(statement)).toMatch(/^(?:CREATE|ALTER|DO)\s/i)
    }
  })
})
