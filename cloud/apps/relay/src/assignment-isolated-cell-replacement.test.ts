import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayAssignmentStore, RelayHomeCellUnavailableError } from './assignment-store.js'
import type { RelayCellConfig } from './config.js'
import {
  openInMemoryRelayDatabase,
  type RelayDatabase,
  type RelayLockOptions,
  type RelayTransactionOptions,
  type SqlRow
} from './database.js'

// A roll's isolate step writes 'migration-only' and its restore writes
// 'general' (cloud/dev/scripts/prepare-relay-production-capacity-canary.mjs:136,
// driven from cloud-deploy-relay-production-same-cap-job.yml:551-566 and
// cloud-deploy-relay-production-capacity-job.yml:768). 'existing-only' is C3's
// decommission posture and is never written by a roll.
const HEARTBEAT_TTL_MS = 45_000
const START_MS = 100
const IDENTITY = { userId: 'user-a', relayHostId: 'host000000000001' }

// A connection-limited cell is what makes deadCellRequiresCommittedFence true,
// which is the branch that used to answer 503 relay_home_cell_unavailable.
const CAPPED = {
  capacityRequests: 1_000,
  connectionHardCap: 600,
  connectionUnobservedBound: 50
} as const
const CELLS: RelayCellConfig[] = [
  { id: 'us-c1', url: 'https://us-c1.example.com', region: 'us-central1', ...CAPPED },
  { id: 'us-c2', url: 'https://us-c2.example.com', region: 'us-central1', ...CAPPED },
  { id: 'asia-c1', url: 'https://asia-c1.example.com', region: 'asia-east2', ...CAPPED }
]

const databases: RelayDatabase[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) await database.close()
})

// Counts the reads this change adds, so the general hot path can be held to a
// single admission lookup and no migration lookup at all.
class QueryCountingDatabase implements RelayDatabase {
  readonly sql: string[] = []

  constructor(private readonly delegate: RelayDatabase) {}

  get dialect(): 'sqlite' | 'postgres' | undefined {
    return this.delegate.dialect
  }

  count(fragment: string): number {
    return this.sql.filter((statement) => statement.includes(fragment)).length
  }

  async query(sql: string, params?: unknown[]): Promise<SqlRow[]> {
    this.sql.push(sql)
    return await this.delegate.query(sql, params)
  }

  async queryLocked(
    sql: string,
    params?: unknown[],
    options?: RelayLockOptions
  ): Promise<SqlRow[]> {
    this.sql.push(sql)
    return await this.delegate.queryLocked(sql, params, options)
  }

  async transaction<T>(
    operation: (transaction: RelayDatabase) => Promise<T>,
    options?: RelayTransactionOptions
  ): Promise<T> {
    return await this.delegate.transaction(
      async (inner) => await operation(new QueryCountingDatabase(this.recording(inner))),
      options
    )
  }

  async close(): Promise<void> {
    await this.delegate.close()
  }

  // Nested transactions get their own wrapper; share this one's tape so a whole
  // assign() is measured as a unit.
  private recording(inner: RelayDatabase): RelayDatabase {
    const tape = this.sql
    return {
      dialect: inner.dialect,
      query: async (sql, params) => {
        tape.push(sql)
        return await inner.query(sql, params)
      },
      queryLocked: async (sql, params, options) => {
        tape.push(sql)
        return await inner.queryLocked(sql, params, options)
      },
      transaction: async (operation, options) => await inner.transaction(operation, options),
      close: async () => await inner.close()
    }
  }
}

interface Harness {
  store: RelayAssignmentStore
  database: RelayDatabase
  counter: QueryCountingDatabase
  heartbeat: (cell: RelayCellConfig) => Promise<void>
  setNow: (value: number) => void
}

async function setup(cells: RelayCellConfig[] = CELLS): Promise<Harness> {
  const inner = await openInMemoryRelayDatabase()
  databases.push(inner)
  const counter = new QueryCountingDatabase(inner)
  let now = START_MS
  const store = new RelayAssignmentStore(counter, () => now, {
    requireLiveCells: true,
    heartbeatTtlMs: HEARTBEAT_TTL_MS
  })
  await store.reconcileCells(cells, true)
  const heartbeat = async (cell: RelayCellConfig): Promise<void> => {
    await store.recordCellHeartbeat({
      cellId: cell.id,
      cellUrl: cell.url,
      cellIncarnation: `1111111${cells.indexOf(cell)}-1111-4111-8111-111111111111`,
      startedAt: 50,
      ready: true,
      observedRequests: 0,
      region: cell.region,
      totalConnections: 0,
      inFlightConnections: 0,
      reservedConnectionUnits: 0,
      enforcedConnectionUnits: 0,
      connectionHardCap: cell.connectionHardCap ?? 600,
      connectionUnobservedBound: cell.connectionUnobservedBound ?? 50
    })
  }
  for (const cell of cells) await heartbeat(cell)
  return { store, database: inner, counter, heartbeat, setNow: (value: number) => (now = value) }
}

async function openMigration(
  database: RelayDatabase,
  input: { sourceCellId: string; targetCellId: string; assignmentEpoch: number; leases: number }
): Promise<void> {
  await database.query(
    `INSERT INTO relay_assignment_migrations
     (user_id, relay_host_id, source_cell_id, target_cell_id, previous_epoch,
      assignment_epoch, source_request_units, target_reserved_units, expires_at,
      target_registered_at, completed_at, aborted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, NULL, NULL, NULL, ?, ?)`,
    [
      IDENTITY.userId,
      IDENTITY.relayHostId,
      input.sourceCellId,
      input.targetCellId,
      input.assignmentEpoch - 1,
      input.assignmentEpoch,
      START_MS + 900_000,
      START_MS,
      START_MS
    ]
  )
  await database.query(
    `UPDATE relay_assignments SET migration_leases = ?
     WHERE user_id = ? AND relay_host_id = ?`,
    [input.leases, IDENTITY.userId, IDENTITY.relayHostId]
  )
}

describe('re-placing a host off a cell isolated for a roll', () => {
  it('leaves a host on a live general cell untouched, at one added admission read', async () => {
    const { store, counter } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')

    counter.sql.length = 0
    const second = await store.assign(IDENTITY, 'us-central1')

    // The grant is identical, not merely same-celled: the clock has not moved,
    // so every field including the lease deadline must match.
    expect(second).toEqual(first)
    expect(counter.count('relay_cell_admission')).toBe(1)
    // The isolation guard's second read never runs for a general incumbent.
    expect(counter.count('relay_assignment_migrations')).toBe(0)
    // No placement: the sticky lane never reaches the fleet-wide inventory.
    expect(counter.count('ORDER BY cell_id ASC')).toBe(0)
  })

  it('re-places a host off a migration-only cell on its next dial', async () => {
    const { store, counter } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')
    await store.setCellAdmissionState(first.cellId, 'migration-only')

    counter.sql.length = 0
    const moved = await store.assign(IDENTITY, 'us-central1')

    expect(moved.cellId).not.toBe(first.cellId)
    expect(moved.assignmentEpoch).toBe(first.assignmentEpoch + 1)
    expect(counter.count('relay_assignment_migrations')).toBeGreaterThan(0)

    // Durable: the next dial does not bounce back to the isolated cell.
    expect(await store.assign(IDENTITY, 'us-central1')).toMatchObject({
      cellId: moved.cellId,
      assignmentEpoch: moved.assignmentEpoch
    })
  })

  it('keeps a host pinned to an existing-only cell that still serves it', async () => {
    // Why: existing-only cells serve the hosts they already hold (PR #194). Only
    // assignmentStrandedOnUnservedCell may release that pin, and only on proof
    // the cell stopped serving this host.
    const { store, database, heartbeat, setNow } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')
    await store.setCellAdmissionState(first.cellId, 'existing-only')
    await database.query(
      `INSERT INTO relay_assignment_activity_leases
       (user_id, relay_host_id, activity_id, activity_kind, cell_id,
        request_units, expires_at, updated_at)
       VALUES (?, ?, 'control:live-1', 'control', ?, 1, ?, ?)`,
      [IDENTITY.userId, IDENTITY.relayHostId, first.cellId, START_MS + 600_000, START_MS]
    )

    // Past the stranded rule's minimum grant age, which outlives the heartbeat TTL.
    setNow(START_MS + 61_000)
    for (const cell of CELLS) await heartbeat(cell)
    expect(await store.assign(IDENTITY, 'us-central1')).toMatchObject({
      cellId: first.cellId,
      assignmentEpoch: first.assignmentEpoch
    })
  })

  it('never re-places onto the isolated cell or any other non-general cell', async () => {
    const { store } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')
    const other = CELLS.find((cell) => cell.region === 'us-central1' && cell.id !== first.cellId)!
    await store.setCellAdmissionState(first.cellId, 'migration-only')
    await store.setCellAdmissionState(other.id, 'migration-only')

    // The only general cell left is out of region, so the fallback is forced.
    expect(await store.assign(IDENTITY, 'us-central1')).toMatchObject({
      cellId: 'asia-c1',
      region: 'asia-east2'
    })
  })

  it('keeps a re-placed host in its own region when that region has a general cell', async () => {
    const { store } = await setup()
    const first = await store.assign(IDENTITY, 'asia-east2')
    expect(first.region).toBe('asia-east2')
    await store.setCellAdmissionState(first.cellId, 'migration-only')
    // asia-c1 is the only Asia cell, so a region-honouring placement has to fall
    // back to US; give Asia a second cell and it must stay.
    const asiaSpare: RelayCellConfig = {
      id: 'asia-c2',
      url: 'https://asia-c2.example.com',
      region: 'asia-east2',
      ...CAPPED
    }
    await store.configureCell(asiaSpare, 'general')
    await store.recordCellHeartbeat({
      cellId: asiaSpare.id,
      cellUrl: asiaSpare.url,
      cellIncarnation: '99999999-9999-4999-8999-999999999999',
      startedAt: 50,
      ready: true,
      observedRequests: 0,
      region: 'asia-east2',
      totalConnections: 0,
      inFlightConnections: 0,
      reservedConnectionUnits: 0,
      enforcedConnectionUnits: 0,
      connectionHardCap: 600,
      connectionUnobservedBound: 50
    })

    expect(await store.assign(IDENTITY, 'asia-east2')).toMatchObject({
      cellId: 'asia-c2',
      region: 'asia-east2'
    })
  })

  it('does not demand a committed fence for a live isolated cell', async () => {
    // §1.8's regression guard: the isolated cell is capped, so the dead-cell
    // fence branch would reject with 503 relay_home_cell_unavailable.
    const { store } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')
    await store.setCellAdmissionState(first.cellId, 'migration-only')

    const moved = await store.assign(IDENTITY, 'us-central1').catch((error: unknown) => error)
    expect(moved).not.toBeInstanceOf(RelayHomeCellUnavailableError)
    expect(moved).toMatchObject({ assignmentEpoch: first.assignmentEpoch + 1 })
  })

  it('leaves the source cell activity leases in place', async () => {
    // Contrast with the fence and stranded paths, which delete them: an isolated
    // cell is alive and still owns drainable work behind those leases.
    const { store, database } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')
    await database.query(
      `INSERT INTO relay_assignment_activity_leases
       (user_id, relay_host_id, activity_id, activity_kind, cell_id,
        request_units, expires_at, updated_at)
       VALUES (?, ?, 'splice:keep-1', 'splice', ?, 1, ?, ?)`,
      [IDENTITY.userId, IDENTITY.relayHostId, first.cellId, START_MS + 600_000, START_MS]
    )
    await store.setCellAdmissionState(first.cellId, 'migration-only')

    await store.assign(IDENTITY, 'us-central1')
    expect(
      await database.query(
        `SELECT activity_id FROM relay_assignment_activity_leases
         WHERE user_id = ? AND relay_host_id = ? AND activity_id = 'splice:keep-1'`,
        [IDENTITY.userId, IDENTITY.relayHostId]
      )
    ).toHaveLength(1)
  })

  it('keeps the pin while a migration lease is outstanding', async () => {
    const { store, database } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')
    await openMigration(database, {
      sourceCellId: first.cellId,
      targetCellId: 'us-c2',
      assignmentEpoch: first.assignmentEpoch,
      leases: 1
    })
    await store.setCellAdmissionState(first.cellId, 'migration-only')

    expect(await store.assign(IDENTITY, 'us-central1')).toMatchObject({
      cellId: first.cellId,
      assignmentEpoch: first.assignmentEpoch
    })
  })

  it('keeps the pin while a migration row is open but its lease has lapsed', async () => {
    // Why: the durable relay_assignment_migrations row outlives the 15-minute
    // lease the counter tracks, and rollBackStalledRegionalRehomes refuses to
    // unwind it while the source is not general. Re-placing here would strand it.
    const { store, database } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')
    await openMigration(database, {
      sourceCellId: first.cellId,
      targetCellId: 'us-c2',
      assignmentEpoch: first.assignmentEpoch,
      leases: 0
    })
    await store.setCellAdmissionState(first.cellId, 'migration-only')

    expect(await store.assign(IDENTITY, 'us-central1')).toMatchObject({
      cellId: first.cellId,
      assignmentEpoch: first.assignmentEpoch
    })
  })

  it('re-places once a settled migration is no longer open', async () => {
    const { store, database } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')
    await openMigration(database, {
      sourceCellId: first.cellId,
      targetCellId: 'us-c2',
      assignmentEpoch: first.assignmentEpoch,
      leases: 0
    })
    await database.query(
      `UPDATE relay_assignment_migrations SET aborted_at = ?
       WHERE user_id = ? AND relay_host_id = ?`,
      [START_MS, IDENTITY.userId, IDENTITY.relayHostId]
    )
    await store.setCellAdmissionState(first.cellId, 'migration-only')

    expect((await store.assign(IDENTITY, 'us-central1')).cellId).not.toBe(first.cellId)
  })

  it('logs one event naming both cells, the admission state and the region', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store } = await setup()
    const first = await store.assign(IDENTITY, 'us-central1')
    await store.setCellAdmissionState(first.cellId, 'migration-only')

    warn.mockClear()
    const moved = await store.assign(IDENTITY, 'us-central1')

    const events = warn.mock.calls
      .map(([line]) => (typeof line === 'string' ? line : ''))
      .filter((line) => line.includes('orca_relay_sticky_replaced_off_isolated_cell'))
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0]!)).toEqual({
      event: 'orca_relay_sticky_replaced_off_isolated_cell',
      fromCellId: first.cellId,
      fromRegion: 'us-central1',
      admissionState: 'migration-only',
      toCellId: moved.cellId,
      region: moved.region
    })
  })
})
