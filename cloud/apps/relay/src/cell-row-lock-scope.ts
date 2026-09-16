import type { SqlRow } from './database.js'

// A transaction may only touch relay_cells rows it has already locked, plus at
// most one row it locks late with a single write while it holds no other.
// Placement takes the inventory in one ascending order so cross-cell cycles
// cannot form; a statement that reaches a second, unordered row is how that
// breaks, and nothing checked it. This is a SQL-shape assertion -- which
// cell_ids does the statement name, against the set the transaction declared --
// so it reads the same on Postgres and on SQLite, and ordinary tests prove it.

type CellRowLockViolation = {
  reason: 'outside-declared-set' | 'unparsed-write'
  cellIds: string[]
  declared: string[]
  statement: string
}

// Every statement runs through observe(), so the pre-filter is a substring test
// rather than a regex. Case-sensitive, like the census that ratchets these sites.
const CELL_TABLE = 'relay_cells'
const CELL_INSERT = /^\s*INSERT\s+INTO\s+relay_cells\s*\(([^)]*)\)\s*VALUES\s*\(/i
const CELL_ROW_WRITE = /^\s*(?:UPDATE|DELETE\s+FROM)\s+relay_cells\b/i
const CELL_TABLE_READ = /\bFROM\s+relay_cells\b/i
const CELL_ID_EQUALS = /\bcell_id\s*=\s*\?/gi

export class CellRowLockScope {
  private readonly declared = new Set<string>()
  // A locked read whose rows do not name their cell. Nothing produces one today;
  // policing would then mean guessing, so the scope stands down instead.
  private opaque = false

  observe(sql: string, params: readonly unknown[], locked: boolean, rows: SqlRow[]): void {
    if (!sql.includes(CELL_TABLE)) return
    // An insert adds a row that by definition was not in the locked set, so it
    // extends the scope rather than violating it.
    if (CELL_INSERT.test(sql)) {
      for (const cellId of insertedCellIds(sql, params)) this.declared.add(cellId)
      return
    }
    if (CELL_ROW_WRITE.test(sql)) {
      this.requireDeclared(sql, params)
      return
    }
    if (locked && CELL_TABLE_READ.test(sql)) this.declare(rows)
  }

  // Why the returned rows and not the WHERE clause: a fleet-wide lock, the
  // general-admission subset and a single-row lock then all declare exactly what
  // they held, including the empty set, with one rule and no SQL to interpret.
  private declare(rows: SqlRow[]): void {
    for (const row of rows) {
      const cellId = row.cell_id
      if (typeof cellId !== 'string') {
        this.opaque = true
        return
      }
      this.declared.add(cellId)
    }
  }

  private requireDeclared(sql: string, params: readonly unknown[]): void {
    if (this.opaque) return
    const cellIds = namedCellIds(sql, params)
    const statement = fingerprint(sql)
    const declared = [...this.declared]
    if (cellIds === undefined) {
      report({ reason: 'unparsed-write', cellIds: [], declared, statement })
      return
    }
    const outside = cellIds.filter((cellId) => !this.declared.has(cellId))
    if (outside.length === 0) return
    // A write is its own lock acquisition, and the release and acquire paths use
    // that deliberately: one row, taken late, held only to COMMIT. It is safe
    // for exactly as long as it is the transaction's only cell row -- a second
    // undeclared row is the unordered two-cell acquisition that cycles.
    if (this.declared.size === 0 && outside.length === 1) {
      this.declared.add(outside[0]!)
      return
    }
    report({ reason: 'outside-declared-set', cellIds: outside, declared, statement })
  }
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
        ` declared=[${violation.declared.join(', ')}] sql=${violation.statement}`
    )
  }
  const signature = `${violation.reason}:${violation.statement}`
  if (reported.has(signature)) return
  reported.add(signature)
  console.warn(
    JSON.stringify({ event: 'orca_relay_cell_row_lock_scope_violation', ...violation })
  )
}
