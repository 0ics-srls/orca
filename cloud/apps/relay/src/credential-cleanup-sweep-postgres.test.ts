import pg from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { RelayCredentialStore, type RelayIdentity } from './credential-store.js'
import { openRelayDatabase, type RelayDatabase } from './database.js'

// The outage this guards against: the credential cleanup ran every 30s in all 23 cells and both
// sweeps over relay_invites had no usable index, so each one seq-scanned the whole table inside the
// maintenance transaction. Only a real planner can show the partial indexes take that away, and
// only a real server has ctid.
const databaseUrl = process.env.ORCA_RELAY_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'relay_credential_sweep_test'

const identity: RelayIdentity = { userId: 'user-1', relayHostId: 'abcdefghijklmnop' }
const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 100 * DAY_MS

function scopedUrl(): string {
  const url = new URL(databaseUrl!)
  url.searchParams.set('options', `-c search_path=${schema}`)
  return url.toString()
}

async function onAdmin<T>(operation: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    return await operation(client)
  } finally {
    await client.end()
  }
}

describePostgres('credential cleanup against PostgreSQL', () => {
  let database: RelayDatabase
  let store: RelayCredentialStore
  const opened: RelayDatabase[] = []

  beforeEach(async () => {
    await onAdmin(async (client) => {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await client.query(`CREATE SCHEMA ${schema}`)
    })
    database = await openRelayDatabase({ databaseUrl: scopedUrl(), dataDir: '' })
    opened.push(database)
    store = new RelayCredentialStore(database, () => NOW)
  })

  afterAll(async () => {
    await Promise.all(opened.map((open) => open.close().catch(() => undefined)))
    await onAdmin((client) => client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`))
  })

  async function seedInvites(
    count: number,
    state: string,
    updatedAt: number,
    expiresAt = NOW - DAY_MS
  ): Promise<void> {
    await database.query(
      `INSERT INTO relay_invites
       (user_id, relay_host_id, relay_device_id, token_hash, state, attempt_count,
        max_attempts, expires_at, created_at, updated_at)
       SELECT ?, ?, 'device-' || n, 'token-' || ? || '-' || n, ?, 0, 3, ?, ?, ?
       FROM generate_series(1, ?) AS n`,
      [identity.userId, identity.relayHostId, state, state, expiresAt, updatedAt, updatedAt, count]
    )
  }

  // Not through RelayDatabase: it routes anything that is not a SELECT to the row-count path, and
  // EXPLAIN on an UPDATE is neither.
  async function plan(sql: string, params: unknown[]): Promise<string> {
    const client = new pg.Client({ connectionString: scopedUrl() })
    await client.connect()
    try {
      let index = 0
      const result = await client.query(
        `EXPLAIN ${sql.replace(/\?/g, () => `$${(index += 1)}`)}`,
        params
      )
      return result.rows.map((row) => String(row['QUERY PLAN'])).join('\n')
    } finally {
      await client.end()
    }
  }

  it('plans both invite sweeps as index scans instead of scanning the whole table', async () => {
    // Production's shape: terminal invites outnumber live ones by orders of magnitude, which is
    // what makes the partial predicates worth having.
    await seedInvites(20_000, 'consumed', NOW)
    for (const state of ['available', 'reserved', 'cooldown']) {
      await seedInvites(200, state, NOW, NOW + DAY_MS)
    }
    await database.query(
      `UPDATE relay_invites SET reservation_expires_at = ? WHERE state = 'reserved'`,
      [NOW + 1]
    )
    // Only ANALYZE makes the planner's row estimates real; without it a cold table looks tiny and
    // a seq scan wins on any index.
    await database.query(`ANALYZE relay_invites`)

    const expiry = await plan(
      `UPDATE relay_invites SET state = 'expired'
       WHERE expires_at <= ? AND state IN ('available', 'reserved', 'cooldown')`,
      [NOW]
    )
    const reservation = await plan(
      `UPDATE relay_invites SET state = 'cooldown'
       WHERE state = 'reserved' AND reservation_expires_at <= ? AND expires_at > ?`,
      [NOW, NOW]
    )

    // Which of the two partial indexes serves the reservation pass is the planner's call: both
    // predicates hold only live invites, so either one reads a handful of rows. The invariant is
    // that neither pass reads the whole table any more.
    for (const sweep of [expiry, reservation]) {
      expect(sweep).not.toContain('Seq Scan on relay_invites')
      expect(sweep).toMatch(/using relay_invites_sweep_(expiry|reservation)/)
    }
    expect(expiry).toContain('relay_invites_sweep_expiry')
  })

  it('plans the pending-authorization and rate-window sweeps as index scans', async () => {
    await database.query(
      `INSERT INTO relay_direct_authorizations
       (direct_auth_id, user_id, relay_host_id, relay_device_id, owning_control_generation,
        deadline, consumed_at)
       SELECT 'auth-' || n, ?, ?, 'device-1', 1, ?, ?
       FROM generate_series(1, 20000) AS n`,
      [identity.userId, identity.relayHostId, NOW - 1, NOW - 1]
    )
    await database.query(
      `INSERT INTO relay_rate_windows (scope_key, window_kind, window_started_at, count)
       SELECT 'scope-' || n, 'invite-mint', ?, 1 FROM generate_series(1, 20000) AS n`,
      [NOW]
    )
    await database.query(`ANALYZE relay_direct_authorizations`)
    await database.query(`ANALYZE relay_rate_windows`)

    const pending = await plan(
      `UPDATE relay_direct_authorizations SET consumed_at = ?
       WHERE consumed_at IS NULL AND deadline <= ?`,
      [NOW, NOW]
    )
    const windows = await plan(`DELETE FROM relay_rate_windows WHERE window_started_at < ?`, [
      NOW - DAY_MS
    ])

    expect(pending).toContain('relay_direct_authorizations_pending_deadline')
    expect(pending).not.toContain('Seq Scan on relay_direct_authorizations')
    expect(windows).toContain('relay_rate_windows_started')
    expect(windows).not.toContain('Seq Scan on relay_rate_windows')
  })

  it('reaps terminal invites past retention through ctid, one bounded batch per cycle', async () => {
    await seedInvites(5_002, 'consumed', NOW - 30 * DAY_MS)
    await seedInvites(3, 'invalidated', NOW - 6 * DAY_MS)
    await seedInvites(2, 'available', NOW - 400 * DAY_MS, NOW + DAY_MS)

    await store.cleanup()
    expect(await database.query(`SELECT count(*) AS total FROM relay_invites`)).toEqual([
      { total: '7' }
    ])

    await store.cleanup()
    // The two live invites and the three inside retention survive; the batch remainder is gone.
    expect(
      await database.query(`SELECT state, count(*) AS total FROM relay_invites GROUP BY state ORDER BY state`)
    ).toEqual([
      { state: 'available', total: '2' },
      { state: 'invalidated', total: '3' }
    ])
  })
})
