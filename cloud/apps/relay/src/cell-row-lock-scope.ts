import type { SqlRow } from './database.js'

// A transaction may WAIT for a relay_cells row lock only in ascending cell_id,
// and re-touching a row it already holds is free. That is what stops cross-cell
// cycles, and nothing checked it: per-statement sorting is not enough, because
// one transaction taking {A} then {B} while another takes {B} then {A} is two
// trivially sorted statements and one deadlock. This is a SQL-shape assertion --
// which cell_ids does the statement name, against what the transaction holds --
// so it reads the same on Postgres and on SQLite, and ordinary tests prove it.

// Waiting is what the order governs. A NOWAIT acquisition either takes the row
// at once or fails, so it is never an edge in a wait-for cycle and its position
// in the order cannot matter; it is still recorded, because a later wait must be
// ordered against everything the transaction holds however it got there.
export type CellRowLockKind = 'none' | 'wait' | 'nowait'

type CellRowLockViolation = {
  reason: 'out-of-order' | 'unordered-lock' | 'unparsed-write'
  cellIds: string[]
  held: string[]
  statement: string
}

// Every statement runs through observe(), so the pre-filter is a substring test
// rather than a regex. Case-sensitive, like the census that ratchets these sites.
const CELL_TABLE = 'relay_cells'
const CELL_INSERT = /^\s*INSERT\s+INTO\s+relay_cells\s*\(([^)]*)\)\s*VALUES\s*\(/i
const CELL_ROW_WRITE = /^\s*(?:UPDATE|DELETE\s+FROM)\s+relay_cells\b/i
const CELL_TABLE_READ = /\bFROM\s+relay_cells\b/i
const CELL_ID_EQUALS = /\bcell_id\s*=\s*\?/gi
const ORDERED_LOCK = /\bORDER\s+BY\s+cell_id\s+ASC\b/i

export class CellRowLockScope {
  private readonly held = new Set<string>()
  // A locked read whose rows do not name their cell. Nothing produces one today;
  // policing would then mean guessing, so the scope stands down instead.
  private opaque = false

  observe(sql: string, params: readonly unknown[], lock: CellRowLockKind, rows: SqlRow[]): void {
    if (!sql.includes(CELL_TABLE)) return
    // An insert adds a row nobody could have locked before it existed, so it
    // extends what the transaction holds and takes no place in the order.
    if (CELL_INSERT.test(sql)) {
      for (const cellId of insertedCellIds(sql, params)) this.held.add(cellId)
      return
    }
    if (CELL_ROW_WRITE.test(sql)) {
      // A write blocks on a conflicting row lock, so it is always a wait. This is
      // how the release and acquire paths take one row late, and what bounds it.
      this.acquire(namedCellIds(sql, params), fingerprint(sql), 'wait')
      return
    }
    if (lock !== 'none' && CELL_TABLE_READ.test(sql)) this.acquireRead(sql, lock, rows)
  }

  private acquireRead(sql: string, lock: CellRowLockKind, rows: SqlRow[]): void {
    if (this.opaque) return
    const statement = fingerprint(sql)
    // A multi-row lock without ORDER BY takes its rows in whatever order the plan
    // produces, so the acquisition order stops being a property of the code.
    if (rows.length > 1 && !ORDERED_LOCK.test(sql)) {
      report({ reason: 'unordered-lock', cellIds: [], held: [...this.held], statement })
    }
    const cellIds: string[] = []
    for (const row of rows) {
      const cellId = row.cell_id
      if (typeof cellId !== 'string') {
        this.opaque = true
        return
      }
      cellIds.push(cellId)
    }
    this.acquire(cellIds, statement, lock)
  }

  private acquire(
    cellIds: string[] | undefined,
    statement: string,
    lock: CellRowLockKind
  ): void {
    if (this.opaque) return
    if (cellIds === undefined) {
      report({ reason: 'unparsed-write', cellIds: [], held: [...this.held], statement })
      return
    }
    for (const cellId of cellIds) {
      if (this.held.has(cellId)) continue
      const below =
        lock === 'nowait' ? [] : [...this.held].filter((held) => sortsBelow(cellId, held))
      if (below.length > 0) {
        report({ reason: 'out-of-order', cellIds: [cellId], held: below, statement })
      }
      this.held.add(cellId)
    }
  }
}

// Why both comparisons: ORDER BY uses the column's collation, which on a
// linguistic locale treats punctuation as secondary, while JS compares code
// units. Reporting only where the two agree keeps a collation difference from
// inventing a violation in the one signal this guard exists to keep clean.
function sortsBelow(candidate: string, held: string): boolean {
  return candidate < held && alphanumeric(candidate) < alphanumeric(held)
}

function alphanumeric(cellId: string): string {
  return cellId.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Positional binding: the nth `?` takes the nth parameter. A `?` inside a string
// literal would shift this, and no relay statement has one.
function placeholderCount(sql: string): number {
  return (sql.match(/\?/g) ?? []).length
}

function namedCellIds(sql: string, params: readonly unknown[]): string[] | undefined {
  const cellIds: string[] = []
  for (const match of sql.matchAll(CELL_ID_EQUALS)) {
    const value = params[placeholderCount(sql.slice(0, match.index))]
    if (typeof value !== 'string') return undefined
    cellIds.push(value)
  }
  // A write that names no single cell reaches rows the scope cannot bound, so it
  // is reported rather than waved through.
  return cellIds.length > 0 ? cellIds : undefined
}

function insertedCellIds(sql: string, params: readonly unknown[]): string[] {
  const match = CELL_INSERT.exec(sql)
  if (!match) return []
  const column = match[1]!.split(',').findIndex((name) => name.trim() === 'cell_id')
  if (column < 0) return []
  const head = sql.slice(0, match.index + match[0].length)
  const tuple = sql.slice(head.length, sql.indexOf(')', head.length)).split(',')
  if (tuple[column]?.trim() !== '?') return []
  const before = tuple.slice(0, column).filter((value) => value.trim() === '?').length
  const cellId = params[placeholderCount(head) + before]
  return typeof cellId === 'string' ? [cellId] : []
}

// Bounded by the number of call sites: relay SQL is static per site, so the
// reported-once set below cannot grow with traffic.
function fingerprint(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 80)
}

const reported = new Set<string>()

// Deliberately not a throw in production. This guard ships ahead of the per-cell
// locking conversions it exists to police, so its first job is to be observed
// firing nowhere -- taking the fleet down to prove a hypothesis is the wrong
// trade. Tests throw, so a real violation still cannot land green.
function report(violation: CellRowLockViolation): void {
  if (process.env.NODE_ENV === 'test') {
    throw new Error(
      `cell_row_lock_scope_violation ${violation.reason}` +
        ` cells=[${violation.cellIds.join(', ')}]` +
        ` held=[${violation.held.join(', ')}] sql=${violation.statement}`
    )
  }
  const signature = `${violation.reason}:${violation.statement}`
  if (reported.has(signature)) return
  reported.add(signature)
  console.warn(
    JSON.stringify({ event: 'orca_relay_cell_row_lock_scope_violation', ...violation })
  )
}
