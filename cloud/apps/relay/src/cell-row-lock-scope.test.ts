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
const CELL_A = `${PREFIX}-a`
const CELL_B = `${PREFIX}-b`
const CELL_C = `${PREFIX}-c`
// Sorts below every seeded cell, so inserting it proves the insert exemption.
const CELL_BELOW = `${PREFIX}-0`
// Sorts below CELL_B under code units and equal to it under a punctuation-
// insensitive collation, so its order against CELL_B is not knowable here.
const CELL_AMBIGUOUS = `${PREFIX}b`

const LOCK_ONE = `SELECT * FROM relay_cells WHERE cell_id = ?`
const INVENTORY_LOCK = `SELECT * FROM relay_cells ORDER BY cell_id ASC`
const UNORDERED_LOCK = `SELECT * FROM relay_cells`
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
      await database.query(`DELETE FROM ${table} WHERE cell_id LIKE '${PREFIX}%'`)
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

  // Why: this is the case a per-statement sort check cannot see. Each statement
  // locks one row and is trivially ordered; the transaction's sequence descends,
  // and a second transaction running it the other way round deadlocks.
  it('catches a descending sequence of individually sorted locks', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(LOCK_ONE, [CELL_C])
        await transaction.queryLocked(LOCK_ONE, [CELL_A])
      })
    ).rejects.toThrow('out-of-order')
  })

  it('allows an ascending sequence of single-row locks', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(LOCK_ONE, [CELL_A])
        await transaction.queryLocked(LOCK_ONE, [CELL_C])
      })
    ).resolves.toBeUndefined()
  })

  // Why: NOWAIT either takes the row at once or fails, so it can never be an edge
  // in a wait-for cycle and its place in the order cannot matter. The sweeps and
  // the contention probes in this suite rely on that.
  it('exempts a NOWAIT acquisition from the order', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(LOCK_ONE, [CELL_C])
        await transaction.queryLocked(LOCK_ONE, [CELL_A], { failIfUnavailable: true })
      })
    ).resolves.toBeUndefined()
  })

  // Why: the exemption covers the NOWAIT acquisition itself, not what follows.
  // A row taken without waiting is still held, and a later wait below it is the
  // edge that closes a cycle.
  it('still catches a wait below a row taken with NOWAIT', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(LOCK_ONE, [CELL_C], { failIfUnavailable: true })
        await transaction.query(RESERVE, [1, 0, CELL_A])
      })
    ).rejects.toThrow('out-of-order')
  })

  it('catches a write below a row the transaction already holds', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(LOCK_ONE, [CELL_C])
        await transaction.query(RESERVE, [1, 0, CELL_A])
      })
    ).rejects.toThrow(VIOLATION)
  })

  it('treats an insert as extending what is held rather than reordering it', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(LOCK_ONE, [CELL_C])
        await transaction.query(INSERT_CELL, [CELL_BELOW, `https://${CELL_BELOW}.example`])
        await transaction.query(RESERVE, [1, 0, CELL_BELOW])
      })
    ).resolves.toBeUndefined()
  })

  // The release and acquire paths take one cell row late, with the atomic write
  // itself, and hold nothing else; adjustCellReservationAtomically exists for it.
  it('allows a row locked late by its own write', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(RESERVE, [1, 0, CELL_B])
        await transaction.query(RESERVE, [2, 0, CELL_B])
      })
    ).resolves.toBeUndefined()
  })

  // Why: an unlocked read is exactly the mistake the guard exists to catch, so
  // it must not be able to authorise the writes that follow it.
  it('does not let an unlocked read hold anything', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(INVENTORY_LOCK)
        await transaction.query(RESERVE, [1, 0, CELL_C])
        await transaction.query(RESERVE, [1, 0, CELL_A])
      })
    ).rejects.toThrow(VIOLATION)
  })

  it('catches a multi-row lock that does not name its order', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(UNORDERED_LOCK)
      })
    ).rejects.toThrow('unordered-lock')
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

  // Why: ORDER BY uses the column collation, which may rank punctuation
  // differently from JS. Reporting a pair the two disagree about would put noise
  // into the one production signal this guard exists to keep clean.
  it('stays silent where the two orderings disagree', async () => {
    await database.query(INSERT_CELL, [CELL_AMBIGUOUS, `https://${CELL_AMBIGUOUS}.example`])

    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(LOCK_ONE, [CELL_AMBIGUOUS])
        await transaction.queryLocked(LOCK_ONE, [CELL_B])
      })
    ).resolves.toBeUndefined()
  })

  // Nothing locks relay_cells without selecting cell_id today. If something does,
  // standing down beats guessing -- a spurious production warning on a shape the
  // guard cannot read would be indistinguishable from the real thing.
  it('stands down on a locked read whose rows do not name their cell', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.queryLocked(
          `SELECT capacity_requests FROM relay_cells WHERE cell_id = ?`,
          [CELL_C]
        )
        await transaction.query(RESERVE, [1, 0, CELL_A])
      })
    ).resolves.toBeUndefined()
  })

  it('scopes what is held to one transaction', async () => {
    for (const cellId of [CELL_C, CELL_A]) {
      await expect(
        database.transaction(async (transaction) => {
          await transaction.query(RESERVE, [1, 0, cellId])
        })
      ).resolves.toBeUndefined()
    }
  })

  // Autocommit statements each commit on their own, so there is no order to
  // police and the guard must stay out of the way.
  it('leaves statements outside a transaction alone', async () => {
    await expect(database.query(RESERVE, [1, 0, CELL_C])).resolves.toBeDefined()
    await expect(database.query(RESERVE, [1, 0, CELL_A])).resolves.toBeDefined()
  })
})
