import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RelayAssignmentStore } from './assignment-store.js'
import type { RelayCellConfig } from './config.js'
import { openRelayDatabase, type RelayDatabase } from './database.js'

const databaseUrl = process.env.ORCA_RELAY_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip

const USER_PREFIX = 'isolated-replacement-postgres'
const NOW = 100
const CAPPED = {
  capacityRequests: 1_000,
  connectionHardCap: 600,
  connectionUnobservedBound: 50
} as const
const ISOLATED: RelayCellConfig = {
  id: 'isolated-replacement-source',
  url: 'https://isolated-replacement-source.example.com',
  region: 'us-central1',
  ...CAPPED
}
const TARGETS: RelayCellConfig[] = [
  {
    id: 'isolated-replacement-target-a',
    url: 'https://isolated-replacement-target-a.example.com',
    region: 'us-central1',
    ...CAPPED
  },
  {
    id: 'isolated-replacement-target-b',
    url: 'https://isolated-replacement-target-b.example.com',
    region: 'us-central1',
    ...CAPPED
  }
]
const CELLS = [ISOLATED, ...TARGETS]
const HOST_COUNT = 50

function hostIdentity(index: number): { userId: string; relayHostId: string } {
  return {
    userId: `${USER_PREFIX}-${index}`,
    // relay host ids are fixed-width opaque ids.
    relayHostId: `isolatedhost${String(index).padStart(4, '0')}`
  }
}

describePostgres('PostgreSQL re-placement off a cell isolated for a roll', () => {
  const databases: RelayDatabase[] = []
  let stores: RelayAssignmentStore[] = []

  async function reservedRequests(cellId: string): Promise<number> {
    const rows = await databases[0]!.query(
      `SELECT reserved_requests FROM relay_cells WHERE cell_id = ?`,
      [cellId]
    )
    return Number(rows[0]!['reserved_requests'])
  }

  async function heartbeatAll(): Promise<void> {
    for (const [index, cell] of CELLS.entries()) {
      await stores[0]!.recordCellHeartbeat({
        cellId: cell.id,
        cellUrl: cell.url,
        cellIncarnation: `1111111${index}-1111-4111-8111-111111111111`,
        startedAt: 50,
        ready: true,
        observedRequests: 0,
        region: cell.region,
        totalConnections: 0,
        inFlightConnections: 0,
        reservedConnectionUnits: 0,
        enforcedConnectionUnits: 0,
        connectionHardCap: 600,
        connectionUnobservedBound: 50
      })
    }
  }

  // Every case starts from the whole fleet general; a case that leaves a cell
  // isolated would otherwise starve the next one of placement candidates.
  async function resetFleet(): Promise<void> {
    await deleteHostRows()
    for (const cell of CELLS) await stores[0]!.setCellAdmissionState(cell.id, 'general')
  }

  async function deleteHostRows(): Promise<void> {
    for (const table of [
      'relay_control_connection_reservations',
      'relay_assignment_activity_leases',
      'relay_assignment_migrations',
      'relay_assignments'
    ]) {
      await databases[0]!.query(`DELETE FROM ${table} WHERE user_id LIKE '${USER_PREFIX}-%'`)
    }
  }

  beforeAll(async () => {
    // Four connections so the concurrent dials below really contend on the
    // fleet-wide relay_cells lock rather than queueing in one client.
    for (let index = 0; index < 4; index += 1) {
      databases.push(await openRelayDatabase({ databaseUrl, dataDir: '' }))
    }
    stores = databases.map(
      (database) =>
        new RelayAssignmentStore(database, () => NOW, {
          requireLiveCells: true,
          heartbeatTtlMs: 45_000
        })
    )
    await deleteHostRows()
    for (const cell of CELLS) await stores[0]!.configureCell(cell, 'general')
    await heartbeatAll()
  })

  afterAll(async () => {
    if (databases[0]) {
      await deleteHostRows()
      for (const cell of CELLS) {
        for (const table of [
          'relay_cell_connection_snapshots',
          'relay_cell_connection_runtime',
          'relay_cell_connection_limits',
          'relay_cell_runtime',
          'relay_cell_admission',
          'relay_cell_regions',
          'relay_cells'
        ]) {
          await databases[0].query(`DELETE FROM ${table} WHERE cell_id = ?`, [cell.id])
        }
      }
    }
    for (const connection of databases) await connection.close()
  })

  it('re-places every host off an isolated cell without leaking a reservation', async () => {
    await resetFleet()
    const identities = Array.from({ length: HOST_COUNT }, (_, index) => hostIdentity(index))
    const sourceBaseline = await reservedRequests(ISOLATED.id)
    const targetBaseline =
      (await reservedRequests(TARGETS[0]!.id)) + (await reservedRequests(TARGETS[1]!.id))

    // Everyone lands on the cell about to be isolated.
    await stores[0]!.configureCell(TARGETS[0]!, 'migration-only')
    await stores[0]!.configureCell(TARGETS[1]!, 'migration-only')
    const first = new Map<string, { cellId: string; assignmentEpoch: number }>()
    for (const identity of identities) {
      const grant = await stores[0]!.assign(identity, 'us-central1')
      expect(grant.cellId).toBe(ISOLATED.id)
      first.set(identity.relayHostId, grant)
    }
    await stores[0]!.configureCell(TARGETS[0]!, 'general')
    await stores[0]!.configureCell(TARGETS[1]!, 'general')

    // The isolate step: admission and enabled move together under the
    // fleet-wide relay_cells lock, so there is no torn state to race against.
    await stores[0]!.setCellAdmissionState(ISOLATED.id, 'migration-only')

    const grants = await Promise.all(
      identities.map(
        async (identity, index) =>
          await stores[1 + (index % (stores.length - 1))]!.assign(identity, 'us-central1')
      )
    )

    for (const [index, grant] of grants.entries()) {
      const identity = identities[index]!
      expect(grant.cellId).not.toBe(ISOLATED.id)
      expect(TARGETS.map(({ id }) => id)).toContain(grant.cellId)
      // Exactly once: a double bump would mean two transactions both moved it.
      expect(grant.assignmentEpoch).toBe(first.get(identity.relayHostId)!.assignmentEpoch + 1)
    }

    expect(await reservedRequests(ISOLATED.id)).toBe(sourceBaseline)
    expect(
      (await reservedRequests(TARGETS[0]!.id)) + (await reservedRequests(TARGETS[1]!.id))
    ).toBe(targetBaseline + HOST_COUNT)

    const rows = await databases[0]!.query(
      `SELECT COUNT(*) AS count FROM relay_assignments
       WHERE user_id LIKE '${USER_PREFIX}-%' AND cell_id = ?`,
      [ISOLATED.id]
    )
    expect(Number(rows[0]!['count'])).toBe(0)
  }, 60_000)

  it('lets exactly one of a host’s racing dials win the re-placement', async () => {
    await resetFleet()
    const identity = hostIdentity(900)
    await stores[0]!.configureCell(TARGETS[0]!, 'migration-only')
    await stores[0]!.configureCell(TARGETS[1]!, 'migration-only')
    const first = await stores[0]!.assign(identity, 'us-central1')
    expect(first.cellId).toBe(ISOLATED.id)
    await stores[0]!.configureCell(TARGETS[0]!, 'general')
    await stores[0]!.configureCell(TARGETS[1]!, 'general')
    const targetBaseline =
      (await reservedRequests(TARGETS[0]!.id)) + (await reservedRequests(TARGETS[1]!.id))
    const sourceBefore = await reservedRequests(ISOLATED.id)

    await stores[0]!.setCellAdmissionState(ISOLATED.id, 'migration-only')

    // Two dials from the same host, on separate connections, through the same
    // sticky lane. The per-assignment row lock is what must serialise them.
    const raced = await Promise.allSettled([
      stores[1]!.assign(identity, 'us-central1'),
      stores[2]!.assign(identity, 'us-central1')
    ])
    const granted = raced.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    )
    expect(granted.length).toBeGreaterThan(0)

    // However many dials were granted, only one re-placement may have
    // committed: the epoch advances by exactly one and the reservation moves
    // exactly one unit.
    const settled = await stores[0]!.resolve(identity)
    expect(settled?.assignmentEpoch).toBe(first.assignmentEpoch + 1)
    expect(settled?.cellId).not.toBe(ISOLATED.id)
    for (const grant of granted) expect(grant.cellId).toBe(settled?.cellId)
    expect(await reservedRequests(ISOLATED.id)).toBe(sourceBefore - 1)
    expect(
      (await reservedRequests(TARGETS[0]!.id)) + (await reservedRequests(TARGETS[1]!.id))
    ).toBe(targetBaseline + 1)
  }, 30_000)

  it('grants no host the isolated cell after the admission flip commits', async () => {
    await resetFleet()
    const identity = hostIdentity(901)
    const first = await stores[0]!.assign(identity, 'us-central1')
    await stores[0]!.setCellAdmissionState(ISOLATED.id, 'migration-only')

    for (let dial = 0; dial < 5; dial += 1) {
      const grant = await stores[1 + (dial % (stores.length - 1))]!.assign(
        identity,
        'us-central1'
      )
      expect(grant.cellId).not.toBe(ISOLATED.id)
    }
    // Only the first dial re-places; the rest are ordinary sticky re-grants.
    expect((await stores[0]!.resolve(identity))?.assignmentEpoch).toBe(
      first.assignmentEpoch + 1
    )
  }, 30_000)
})
