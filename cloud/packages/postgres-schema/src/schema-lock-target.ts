// The object a boot-time DDL statement locks on Postgres, so the catalog can be asked whether it
// already exists before the statement joins the lock queue. `table` is kept exactly as the
// statement wrote it, schema qualification and quoting included, because it is fed to
// `to_regclass`; `name` is the bare identifier the catalog stores in `relname`/`attname`.
export type SchemaLockTarget = {
  kind: 'index' | 'column'
  table: string
  name: string
}

const IDENTIFIER = '"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*'
const QUALIFIED = `((?:${IDENTIFIER})(?:\\.(?:${IDENTIFIER}))?)`

const LEADING_COMMENT = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/

// A schema string split on ';' hands each statement the comment block written above it, and `\s`
// never matches '--', so classifying the raw text reads those statements as unknown and drops both
// their retry handling and their catalog pre-check.
export function sqlWithoutLeadingComments(statement: string): string {
  return statement.replace(LEADING_COMMENT, '')
}

const CREATE_INDEX = new RegExp(
  `^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?` +
    `${QUALIFIED}\\s+ON\\s+(?:ONLY\\s+)?${QUALIFIED}`,
  'i'
)
const ADD_COLUMN = new RegExp(
  `^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${QUALIFIED}\\s+` +
    `ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUALIFIED}`,
  'i'
)

// Every statement shape that takes a relation lock before Postgres evaluates its existence test.
// `CREATE TABLE IF NOT EXISTS` is absent on purpose: it resolves a name against the schema and
// takes no lock on an existing table.
const TAKES_RELATION_LOCK = /^(?:CREATE\s+(?:UNIQUE\s+)?INDEX|ALTER\s+TABLE)\b/i

export function takesRelationLock(statement: string): boolean {
  return TAKES_RELATION_LOCK.test(sqlWithoutLeadingComments(statement))
}

// `"a""b"` is one identifier whose stored name is `a"b`.
function bareIdentifier(written: string): string {
  const last = written.split('.').pop() ?? written
  return last.startsWith('"') ? last.slice(1, -1).replace(/""/g, '"') : last
}

// Derived from the statement itself so a renamed index cannot drift away from its pre-check.
export function schemaLockTarget(statement: string): SchemaLockTarget | undefined {
  const sql = sqlWithoutLeadingComments(statement)
  const index = CREATE_INDEX.exec(sql)
  if (index?.[1] && index[2]) {
    return { kind: 'index', table: index[2], name: bareIdentifier(index[1]) }
  }
  const column = ADD_COLUMN.exec(sql)
  if (column?.[1] && column[2]) {
    return { kind: 'column', table: column[1], name: bareIdentifier(column[2]) }
  }
  return undefined
}
