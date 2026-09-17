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

export type CellRowLockScopeOutcome = {
  checked: boolean
  stoodDown: boolean
  violations: number
}

export function emptyCellRowLockScopeOutcome(): CellRowLockScopeOutcome {
  return { checked: false, stoodDown: false, violations: 0 }
}

// Why max and not sum: a retry replays the same statements, so a transaction that
// violated, was retried and violated again is one logical violation seen twice.
// Summing would make the count rise with contention rather than with breakage.
export function mergeCellRowLockScopeOutcomes(
  left: CellRowLockScopeOutcome,
  right: CellRowLockScopeOutcome
): CellRowLockScopeOutcome {
  return {
    checked: left.checked || right.checked,
    stoodDown: left.stoodDown || right.stoodDown,
    violations: Math.max(left.violations, right.violations)
  }
}

// Why: `violations === 0` is only evidence if something was examined. Checked
// counts transactions where at least one relay_cells write was evaluated, which
// is the population a per-cell conversion moves; stoodDown counts the ones this
// guard refused to reason about, and must read as a bug, not as a clean run.
export type CellRowLockScopeCounts = {
  cellRowLockScopesChecked: number
  cellRowLockScopesStoodDown: number
  cellRowLockScopeViolations: number
}

export function emptyCellRowLockScopeCounts(): CellRowLockScopeCounts {
  return {
    cellRowLockScopesChecked: 0,
    cellRowLockScopesStoodDown: 0,
    cellRowLockScopeViolations: 0
  }
}

export class CellRowLockScopeSamples {
  private counts = emptyCellRowLockScopeCounts()

  record(outcome: CellRowLockScopeOutcome): void {
    if (outcome.checked) this.counts.cellRowLockScopesChecked += 1
    if (outcome.stoodDown) this.counts.cellRowLockScopesStoodDown += 1
    this.counts.cellRowLockScopeViolations += outcome.violations
  }

  consumeCounts(): CellRowLockScopeCounts {
    const counts = this.counts
    this.counts = emptyCellRowLockScopeCounts()
    return counts
  }
}

// Every statement runs through observe(), so the pre-filter is a substring test
// rather than a regex. Case-sensitive, like the census that ratchets these sites.
const CELL_TABLE = 'relay_cells'
const CELL_INSERT = /^\s*INSERT\s+INTO\s+relay_cells\s*\(([^)]*)\)\s*VALUES\s*\(/i
const CELL_ROW_WRITE = /^\s*(?:UPDATE|DELETE\s+FROM)\s+relay_cells\b/i
// The statement's own relation, not any mention of the table. A locked read of
// another table that names relay_cells in a JOIN or an EXISTS locks no cell row,
// and every one of those tables carries a cell_id column that would otherwise be
// taken for a held row.
const CELL_TABLE_READ = /^\s*SELECT\b[\s\S]*?\bFROM\s+([A-Za-z_]\w*)/i
const CELL_ID_EQUALS = /\bcell_id\s*=\s*\?/gi
const ORDERED_LOCK = /\bORDER\s+BY\s+cell_id\s+ASC\b/i
// An upsert is not the free set-extension a plain insert is: when the row it
// names already exists it takes that row's lock and BLOCKS, so it is a waiting
// acquisition and belongs under the order check. Proven against PostgreSQL 16 --
// an upsert of a row another transaction held FOR UPDATE waited out the lock
// timeout, and the obvious two-transaction interleaving deadlocks. The census in
// this repo has always counted INSERT as a cell-row lock site; the guard used to
// disagree with it.
const CELL_UPSERT = /\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b/i

export class CellRowLockScope {
  private readonly held = new Set<string>()
  // A locked read whose rows do not name their cell. Nothing produces one today;
  // policing would then mean guessing, so the scope stands down instead -- but
  // never silently, or its silence would read the same as a clean transaction.
  private opaque = false
  private checked = false
  private violations = 0
  // Set by a lock that took the whole inventory in order. While it holds, every
  // row that existed is held, so an upsert naming an unheld row is creating one.
  private coveredInventory = false

  // Why the wrapper: this runs inside the caller's try, so anything thrown here
  // escapes as that statement's failure and is mislabelled with its SQL phase on
  // the way out. A warn-only observer must be structurally unable to fail a
  // request, not merely unable in the shapes reachable today.
  observe(sql: string, params: readonly unknown[], lock: CellRowLockKind, rows: SqlRow[]): void {
    try {
      this.inspect(sql, params, lock, rows)
    } catch (error) {
      if (error instanceof CellRowLockScopeViolationError) throw error
      this.opaque = true
      reportStandDown(`unreadable:${fingerprint(sql)}`)
    }
  }

  private inspect(
    sql: string,
    params: readonly unknown[],
    lock: CellRowLockKind,
    rows: SqlRow[]
  ): void {
    if (!sql.includes(CELL_TABLE)) return
    if (CELL_INSERT.test(sql)) {
      const inserted = insertedCellIds(sql, params)
      // An upsert waits on the row it collides with, so a collision is ordered
      // like any other write -- but creating a row nobody could name yet is free,
      // and the statement text cannot tell the two apart. What settles it is
      // whether the transaction already covered the inventory: under a
      // fleet-wide lock every row that existed is held, so an unheld target did
      // not exist and cannot be contended. Remove that lock -- which is exactly
      // what the per-cell conversion does -- and the same upsert becomes a
      // genuine unordered acquisition, which is when this starts reporting.
      if (CELL_UPSERT.test(sql) && !this.coveredInventory) {
        this.note()
        this.acquire(inserted.length > 0 ? inserted : undefined, fingerprint(sql), 'wait')
        return
      }
      for (const cellId of inserted) this.held.add(cellId)
      return
    }
    if (CELL_ROW_WRITE.test(sql)) {
      // A write blocks on a conflicting row lock, so it is always a wait. This is
      // how the release and acquire paths take one row late, and what bounds it.
      this.note()
      this.acquire(namedCellIds(sql, params), fingerprint(sql), 'wait')
      return
    }
    if (lock !== 'none' && CELL_TABLE_READ.exec(sql)?.[1] === CELL_TABLE) {
      this.acquireRead(sql, lock, rows)
    }
  }

  // Why: a guard that reports nothing is indistinguishable from a guard that was
  // never reached or quietly stood down, and the deploy plan is to trust its
  // silence. These give the silence a denominator.
  outcome(): CellRowLockScopeOutcome {
    return { checked: this.checked, stoodDown: this.opaque, violations: this.violations }
  }

  // Why reads count too: `checked` is the denominator for "the guard saw the
  // population a per-cell conversion moves", and that population is every
  // transaction that acquires a cell row lock. Counting only writes missed 44% of
  // them when measured across this suite -- including the fleet-wide
  // `SELECT ... FOR UPDATE` the conversion exists to replace, which scored zero.
  private note(): void {
    if (!this.opaque) this.checked = true
  }

  private acquireRead(sql: string, lock: CellRowLockKind, rows: SqlRow[]): void {
    if (this.opaque) return
    const statement = fingerprint(sql)
    // Shape, not row count: a lock that names no single cell may return one row
    // in a fixture and many in production, so judging it by what came back makes
    // the ratchet depend on the data. If it cannot return exactly one row by
    // construction, its acquisition order has to be written down.
    if (!ORDERED_LOCK.test(sql) && !namesOneCell(sql) && rows.length > 0) {
      this.report({ reason: 'unordered-lock', cellIds: [], held: [...this.held], statement })
    }
    const cellIds: string[] = []
    for (const row of rows) {
      const cellId = row.cell_id
      if (typeof cellId !== 'string') {
        this.opaque = true
        reportStandDown(statement)
        return
      }
      cellIds.push(cellId)
    }
    // Counted here and not on entry: a read that stands down was not judged, and
    // counting it would put transactions the guard declined to reason about into
    // the denominator that says how many it did.
    this.note()
    if (!namesOneCell(sql) && ORDERED_LOCK.test(sql)) this.coveredInventory = true
    this.acquire(cellIds, statement, lock)
  }

  // Counted before it is thrown: in production report() only warns, so the count
  // is what carries the magnitude the once-per-signature log deliberately drops.
  private report(violation: CellRowLockViolation): void {
    this.violations += 1
    report(violation)
  }

  private acquire(
    cellIds: string[] | undefined,
    statement: string,
    lock: CellRowLockKind
  ): void {
    if (this.opaque) return
    if (cellIds === undefined) {
      this.report({ reason: 'unparsed-write', cellIds: [], held: [...this.held], statement })
      return
    }
    for (const cellId of cellIds) {
      if (this.held.has(cellId)) continue
      const below =
        lock === 'nowait' ? [] : [...this.held].filter((held) => sortsBelow(cellId, held))
      if (below.length > 0) {
        this.report({ reason: 'out-of-order', cellIds: [cellId], held: below, statement })
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

// Shape only, no parameters: whether the statement can return more than one row,
// not whether it happened to. Exactly one `cell_id = ?` and no `OR` pins it to a
// single row; anything else may widen in production even if a fixture returned one.
function namesOneCell(sql: string): boolean {
  return (sql.match(CELL_ID_EQUALS) ?? []).length === 1 && !/\bOR\b/i.test(sql)
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

// Never throws: standing down is not a failed invariant, it is the guard
// declining to judge a shape it cannot read. It still has to be visible, or the
// counters would be the only trace and a silent scope would look like a clean one.
function reportStandDown(statement: string): void {
  const signature = `stood-down:${statement}`
  if (reported.has(signature)) return
  reported.add(signature)
  console.warn(
    JSON.stringify({ event: 'orca_relay_cell_row_lock_scope_stood_down', statement })
  )
}

// Deliberately not a throw in production. This guard ships ahead of the per-cell
// locking conversions it exists to police, so its first job is to be observed
// firing nowhere -- taking the fleet down to prove a hypothesis is the wrong
// trade. Tests throw, so a real violation still cannot land green.
// Distinct from an unreadable statement so observe()'s catch can tell a real
// violation apart from the guard's own failure and rethrow only the former.
export class CellRowLockScopeViolationError extends Error {}

function report(violation: CellRowLockViolation): void {
  if (process.env.NODE_ENV === 'test') {
    throw new CellRowLockScopeViolationError(
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
