import { describe, expect, it } from 'vitest'
import { RelayCredentialStore, type RelayIdentity } from './credential-store.js'
import { openInMemoryRelayDatabase, type RelayDatabase } from './database.js'

const identity: RelayIdentity = { userId: 'user-1', relayHostId: 'abcdefghijklmnop' }
const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 100 * DAY_MS

async function insertInvite(
  database: RelayDatabase,
  invite: { token: string; state: string; updatedAt: number; expiresAt?: number }
): Promise<void> {
  await database.query(
    `INSERT INTO relay_invites
     (user_id, relay_host_id, relay_device_id, token_hash, state, attempt_count,
      max_attempts, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      identity.userId,
      identity.relayHostId,
      `device-${invite.token}`,
      invite.token,
      invite.state,
      0,
      3,
      invite.expiresAt ?? NOW + DAY_MS,
      invite.updatedAt,
      invite.updatedAt
    ]
  )
}

async function remainingTokens(database: RelayDatabase): Promise<string[]> {
  const rows = await database.query(`SELECT token_hash FROM relay_invites ORDER BY token_hash`)
  return rows.map((row) => String(row.token_hash))
}

describe('credential cleanup invite reaper', () => {
  it('deletes terminal invites past retention and keeps everything else', async () => {
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => NOW)
    const stale = NOW - 8 * DAY_MS
    const recent = NOW - 6 * DAY_MS
    for (const state of ['expired', 'consumed', 'invalidated']) {
      await insertInvite(database, { token: `stale-${state}`, state, updatedAt: stale })
      await insertInvite(database, { token: `recent-${state}`, state, updatedAt: recent })
    }

    await store.cleanup()

    expect(await remainingTokens(database)).toEqual([
      'recent-consumed',
      'recent-expired',
      'recent-invalidated'
    ])
    await database.close()
  })

  it('never deletes an invite that a reader could still consume, however old', async () => {
    // Retention is measured on updated_at, and a long-lived available invite has an old one. The
    // state filter is what keeps the reaper from deleting a credential still in use.
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => NOW)
    const ancient = NOW - 400 * DAY_MS
    for (const state of ['available', 'reserved', 'cooldown']) {
      await insertInvite(database, {
        token: `live-${state}`,
        state,
        updatedAt: ancient,
        expiresAt: NOW + DAY_MS
      })
    }

    await store.cleanup()

    expect(await remainingTokens(database)).toEqual(['live-available', 'live-cooldown', 'live-reserved'])
    await database.close()
  })

  it('bounds one cycle to a single batch and drains the rest on later cycles', async () => {
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => NOW)
    const stale = NOW - 30 * DAY_MS
    for (let index = 0; index < 5_002; index += 1) {
      await insertInvite(database, {
        token: `consumed-${String(index).padStart(5, '0')}`,
        state: 'consumed',
        updatedAt: stale
      })
    }

    await store.cleanup()
    expect(await remainingTokens(database)).toHaveLength(2)

    await store.cleanup()
    expect(await remainingTokens(database)).toEqual([])
    await database.close()
  })

  it('still expires credentials the sweep owns, and only those past their deadline', async () => {
    // The reaper runs after the sweep in the same call, so this pins that adding it did not
    // displace any of the five state transitions the sweep is there for.
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => NOW)
    await insertInvite(database, {
      token: 'lapsed',
      state: 'available',
      updatedAt: NOW,
      expiresAt: NOW - 1
    })
    await insertInvite(database, {
      token: 'current',
      state: 'available',
      updatedAt: NOW,
      expiresAt: NOW + DAY_MS
    })
    await database.query(
      `UPDATE relay_invites SET state = ?, reservation_expires_at = ? WHERE token_hash = ?`,
      ['reserved', NOW - 1, 'current']
    )
    await database.query(
      `INSERT INTO relay_connection_bases
       (basis_conn_id, user_id, relay_host_id, relay_device_id, owning_control_generation,
        credential_kind, deadline, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'basis-lapsed', identity.userId, identity.relayHostId, 'device-1', 1, 'invite', NOW - 1, 1, NOW,
        'basis-live', identity.userId, identity.relayHostId, 'device-1', 1, 'invite', NOW + 1, 1, NOW
      ]
    )
    await store.recordDirectAuthorization({
      ...identity,
      relayDeviceId: 'device-1',
      directAuthId: 'direct-lapsed',
      owningControlGeneration: 1,
      deadline: NOW - 1
    })
    await store.recordDirectAuthorization({
      ...identity,
      relayDeviceId: 'device-1',
      directAuthId: 'direct-live',
      owningControlGeneration: 1,
      deadline: NOW + 1
    })
    await database.query(
      `INSERT INTO relay_rate_windows (scope_key, window_kind, window_started_at, count)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
      ['scope', 'invite-mint', NOW - 2 * DAY_MS, 1, 'scope', 'invite-mint', NOW - 1, 1]
    )

    await store.cleanup()

    expect(
      await database.query(`SELECT token_hash, state FROM relay_invites ORDER BY token_hash`)
    ).toEqual([
      { token_hash: 'current', state: 'cooldown' },
      { token_hash: 'lapsed', state: 'expired' }
    ])
    expect(
      await database.query(`SELECT basis_conn_id, active FROM relay_connection_bases ORDER BY basis_conn_id`)
    ).toEqual([
      { basis_conn_id: 'basis-lapsed', active: 0 },
      { basis_conn_id: 'basis-live', active: 1 }
    ])
    expect(
      await database.query(
        `SELECT direct_auth_id FROM relay_direct_authorizations
         WHERE consumed_at IS NULL ORDER BY direct_auth_id`
      )
    ).toEqual([{ direct_auth_id: 'direct-live' }])
    expect(await database.query(`SELECT window_started_at FROM relay_rate_windows`)).toEqual([
      { window_started_at: NOW - 1 }
    ])
    await database.close()
  })
})
