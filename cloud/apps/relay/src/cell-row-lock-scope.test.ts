import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  openInMemoryRelayDatabase,
  openRelayDatabase,
  type RelayDatabase
} from './database.js'

// Driven through the real database so the assertions cover the hook in the
// transaction classes, not a scope object held on its own: unwire either
// constructor in database.ts and every rejection below turns into a resolution.
// Run on both dialects because "identical on Postgres and SQLite" is the design
// claim that lets the cheap suite prove the invariant.

const PREFIX = 'lock-scope'
const CELL_IDS = [`${PREFIX}-a`, `${PREFIX}-b`, `${PREFIX}-c`, `${PREFIX}-d`]
const [CELL_A, CELL_B, CELL_C, CELL_D] = CELL_IDS as [string, string, string, string]

const INVENTORY_LOCK = `SELECT * FROM relay_cells ORDER BY cell_id ASC`
const RESERVE = `UPDATE relay_cells SET reserved_requests = ?, updated_at = ? WHERE cell_id = ?`
const INSERT_CELL = `INSERT INTO relay_cells
 (cell_id, cell_url, enabled, capacity_requests, reserved_requests,
  observed_requests, last_heartbeat_at, updated_at)
 VALUES (?, ?, 1, 10, 0, 0, 0, 0)`

const VIOLATION = 'cell_row_lock_scope_violation'

const databaseUrl = process.env.ORCA_RELAY_TEST_POSTGRES_URL
const backends: { name: string; open: () => Promise<RelayDatabase> }[] = [
  { name: 'sqlite', open: openInMemoryRelayDatabase },
  ...(databaseUrl
    ? [{ name: 'postgres', open: () => openRelayDatabase({ databaseUrl, dataDir: '' }) }]
    : [])
]

const opened: RelayDatabase[] = []

afterAll(async () => {
  for (const database of opened.splice(0)) await database.close()
})

describe.each(backends)('cell row lock scope ($name)', ({ open }) => {
  let database: RelayDatabase

  // The Postgres backend is one shared CI database, so these rows are scoped by
  // prefix and removed on both sides of every test: a leftover cell fails the
  // later suites that assert on the whole inventory.
  async function removeScopedCells(): Promise<void> {
    for (const table of ['relay_cell_regions', 'relay_cells']) {
      await database.query(`DELETE FROM ${table} WHERE cell_id LIKE '${PREFIX}-%'`)
    }
  }

  beforeEach(async () => {
    if (!database) {
      database = await open()
      opened.push(database)
    }
    await removeScopedCells()
    for (const cellId of [CELL_A, CELL_B, CELL_C]) {
      await database.query(INSERT_CELL, [cellId, `https://${cellId}.example`])
    }
  })

  afterEach(removeScopedCells)

  it('lets a fleet-wide lock cover every later single-cell write', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(INVENTORY_LOCK)
        await transaction.query(RESERVE, [1, 0, CELL_C])
        await transaction.query(RESERVE, [1, 0, CELL_A])
      })
    ).resolves.toBeUndefined()
  })

  it('catches a write to a cell the transaction locked a different row for', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(`SELECT * FROM relay_cells WHERE cell_id = ?`, [CELL_A])
        await transaction.query(RESERVE, [1, 0, CELL_B])
      })
    ).rejects.toThrow(VIOLATION)
  })

  it('treats an insert as extending the locked set rather than escaping it', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(INVENTORY_LOCK)
        await transaction.query(INSERT_CELL, [CELL_D, `https://${CELL_D}.example`])
        await transaction.query(RESERVE, [1, 0, CELL_D])
      })
    ).resolves.toBeUndefined()
  })

  // The release and acquire paths take one cell row late, with the atomic write
  // itself, and hold nothing else; adjustCellReservationAtomically exists for it.
  it('allows one row locked late by its own write', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(RESERVE, [1, 0, CELL_B])
        await transaction.query(RESERVE, [2, 0, CELL_B])
      })
    ).resolves.toBeUndefined()
  })

  it('catches a second row locked late, which is the unordered acquisition', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(RESERVE, [1, 0, CELL_A])
        await transaction.query(RESERVE, [1, 0, CELL_B])
      })
    ).rejects.toThrow(VIOLATION)
  })

  // Why: an unlocked read is exactly the mistake the guard exists to catch, so
  // it must not be able to authorise the writes that follow it.
  it('does not let an unlocked read declare anything', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(INVENTORY_LOCK)
        await transaction.query(RESERVE, [1, 0, CELL_A])
        await transaction.query(RESERVE, [1, 0, CELL_B])
      })
    ).rejects.toThrow(VIOLATION)
  })

  it('reports a relay_cells write that names no cell at all', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(INVENTORY_LOCK)
        await transaction.query(`UPDATE relay_cells SET updated_at = ? WHERE cell_url LIKE ?`, [
          1,
          `https://${PREFIX}-%`
        ])
      })
    ).rejects.toThrow('unparsed-write')
  })

  // Nothing locks relay_cells without selecting cell_id today. If something does,
  // standing down beats guessing -- a spurious production warning on a shape the
  // guard cannot read would be indistinguishable from the real thing.
  it('stands down on a locked read whose rows do not name their cell', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(
          `SELECT capacity_requests FROM relay_cells WHERE cell_id = ?`,
          [CELL_A]
        )
        await transaction.query(RESERVE, [1, 0, CELL_B])
        await transaction.query(RESERVE, [1, 0, CELL_C])
      })
    ).resolves.toBeUndefined()
  })

  it('scopes the declared set to one transaction', async () => {
    for (const cellId of [CELL_A, CELL_B]) {
      await expect(
        database.transaction(async (transaction) => {
          await transaction.query(RESERVE, [1, 0, cellId])
        })
      ).resolves.toBeUndefined()
    }
  })

  // Autocommit statements each commit on their own, so there is no scope to
  // police and the guard must stay out of the way.
  it('leaves statements outside a transaction alone', async () => {
    await expect(database.query(RESERVE, [1, 0, CELL_A])).resolves.toBeDefined()
    await expect(database.query(RESERVE, [1, 0, CELL_B])).resolves.toBeDefined()
  })
})
