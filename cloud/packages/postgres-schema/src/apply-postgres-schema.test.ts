import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyPostgresSchema } from './apply-postgres-schema.js'
import type { SchemaCatalogRow } from './catalog-object-precheck.js'

function postgresError(code: string, constraint?: string): Error {
  return Object.assign(new Error(code), constraint === undefined ? { code } : { code, constraint })
}

const COMMENTED_INDEX = `-- Why the sweep needs this index
CREATE INDEX IF NOT EXISTS relay_bases_active ON relay_connection_bases(active, deadline)`

const COMMENTED_TABLE = `-- Two comment lines, the other shape a split schema carries
-- above a statement
CREATE TABLE IF NOT EXISTS relay_cells (
  cell_id TEXT PRIMARY KEY
)`

function catalogAnswers(rows: SchemaCatalogRow[]): {
  catalogQuery: (sql: string, params: unknown[]) => Promise<SchemaCatalogRow[]>
  asked: unknown[][]
} {
  const asked: unknown[][] = []
  return {
    asked,
    catalogQuery: async (sql, params) => {
      asked.push([sql, ...params])
      return rows
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('applyPostgresSchema classification', () => {
  it('classifies a comment-prefixed CREATE INDEX by its first SQL keyword', async () => {
    let calls = 0
    const query = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw postgresError('42P07')
      return undefined
    })
    await applyPostgresSchema([COMMENTED_INDEX], query, { wait: async () => undefined })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('classifies a comment-prefixed CREATE TABLE by its own collision codes', async () => {
    // pg_type_typname_nsp_index is reached only through the CREATE TABLE branch, so a statement
    // misread as unknown would fail the boot on a benign concurrent create instead of retrying.
    let calls = 0
    const query = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw postgresError('23505', 'pg_type_typname_nsp_index')
      return undefined
    })
    await applyPostgresSchema([COMMENTED_TABLE], query, { wait: async () => undefined })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('retries a concurrent index collision until it succeeds', async () => {
    let calls = 0
    const query = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw postgresError('23505', 'pg_class_relname_nsp_index')
      return undefined
    })
    const summary = await applyPostgresSchema(['CREATE INDEX IF NOT EXISTS i ON t(c)'], query, {
      wait: async () => undefined
    })
    expect(query).toHaveBeenCalledTimes(3)
    expect(summary).toEqual({ ran: 1, skipped: 0 })
  })

  it('treats an already-applied constraint as skipped rather than an error', async () => {
    const query = vi.fn(async () => {
      throw postgresError('42710')
    })
    const summary = await applyPostgresSchema(['ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0)'], query)
    expect(summary).toEqual({ ran: 0, skipped: 1 })
  })

  it('propagates an unrelated error without retrying', async () => {
    const query = vi.fn(async () => {
      throw postgresError('42501')
    })
    await expect(
      applyPostgresSchema(['CREATE TABLE IF NOT EXISTS t (id TEXT)'], query)
    ).rejects.toThrow(/42501/)
    expect(query).toHaveBeenCalledTimes(1)
  })
})

describe('applyPostgresSchema lock timeouts', () => {
  it('does not retry a lock timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const query = vi.fn(async () => {
      throw postgresError('55P03')
    })
    await expect(
      applyPostgresSchema(['CREATE INDEX IF NOT EXISTS i ON t(c)'], query, {
        wait: async () => undefined
      })
    ).rejects.toThrow(/55P03/)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('names the statement that could not take its lock', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      lines.push(line)
    })
    const query = vi.fn(async () => {
      throw postgresError('55P03')
    })
    await expect(applyPostgresSchema([COMMENTED_INDEX], query)).rejects.toThrow(/55P03/)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'orca_relay_postgres_schema_lock_timeout',
      code: '55P03',
      statement: 'CREATE INDEX IF NOT EXISTS relay_bases_active ON relay_connection_bases(active, deadline)'
    })
  })

  it('still retries a lock timeout for a caller that opts in', async () => {
    // A caller with no catalog pre-check learns nothing from a lock timeout about whether the
    // object exists, so its old bounded retry is the correct behaviour there.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let calls = 0
    const query = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw postgresError('55P03')
      return undefined
    })
    await applyPostgresSchema(['CREATE INDEX IF NOT EXISTS i ON t(c)'], query, {
      retryLockTimeout: true,
      wait: async () => undefined
    })
    expect(query).toHaveBeenCalledTimes(3)
  })
})

describe('applyPostgresSchema catalog pre-check', () => {
  it('sends no lock-taking statement when the catalog has the object', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const query = vi.fn(async (_statement: string) => undefined)
    const { catalogQuery, asked } = catalogAnswers([{ indisvalid: true }])
    const summary = await applyPostgresSchema([COMMENTED_TABLE, COMMENTED_INDEX], query, {
      catalogQuery
    })
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([COMMENTED_TABLE])
    expect(asked).toEqual([
      [expect.stringContaining('pg_catalog.pg_index'), 'relay_connection_bases', 'relay_bases_active']
    ])
    expect(summary).toEqual({ ran: 1, skipped: 1 })
  })

  it('skips an index the catalog reports as invalid rather than rebuilding it', async () => {
    // A cancelled CREATE INDEX CONCURRENTLY leaves exactly this state, and IF NOT EXISTS skips it
    // too, so reading indisvalid as a condition would newly take the lock it used to avoid.
    const logged: { event?: string }[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logged.push(JSON.parse(line))
    })
    const query = vi.fn(async (_statement: string) => undefined)
    const { catalogQuery } = catalogAnswers([{ indisvalid: false }])
    await applyPostgresSchema([COMMENTED_INDEX], query, { catalogQuery })
    expect(query).not.toHaveBeenCalled()
    expect(logged.filter((entry) => entry.event?.endsWith('_object_present'))).toEqual([
      {
        event: 'orca_relay_postgres_schema_object_present',
        kind: 'index',
        table: 'relay_connection_bases',
        name: 'relay_bases_active',
        indisvalid: false
      }
    ])
  })

  it('reports how many statements ran and how many were skipped', async () => {
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logged.push(line)
    })
    const { catalogQuery } = catalogAnswers([{ indisvalid: true }])
    await applyPostgresSchema([COMMENTED_TABLE, COMMENTED_INDEX], vi.fn(async () => undefined), {
      catalogQuery,
      eventPrefix: 'orca_push_postgres_schema'
    })
    expect(JSON.parse(logged[logged.length - 1] ?? '{}')).toEqual({
      event: 'orca_push_postgres_schema_applied',
      ran: 1,
      skipped: 1
    })
  })

  it('asks pg_attribute for a column and sends the ALTER TABLE when no row comes back', async () => {
    const query = vi.fn(async (_statement: string) => undefined)
    const { catalogQuery, asked } = catalogAnswers([])
    const statement = 'ALTER TABLE relay_control_capabilities ADD COLUMN IF NOT EXISTS idle BIGINT'
    const summary = await applyPostgresSchema([statement], query, { catalogQuery })
    expect(asked).toEqual([
      [expect.stringContaining('pg_catalog.pg_attribute'), 'relay_control_capabilities', 'idle']
    ])
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([statement])
    expect(summary).toEqual({ ran: 1, skipped: 0 })
  })

  it('never probes the catalog for a statement that takes no relation lock', async () => {
    const query = vi.fn(async (_statement: string) => undefined)
    const { catalogQuery, asked } = catalogAnswers([{ indisvalid: true }])
    await applyPostgresSchema([COMMENTED_TABLE, 'ALTER TABLE t DROP CONSTRAINT IF EXISTS c'], query, {
      catalogQuery
    })
    expect(asked).toEqual([])
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('sends every statement when no catalog query is supplied', async () => {
    const query = vi.fn(async (_statement: string) => undefined)
    const summary = await applyPostgresSchema([COMMENTED_TABLE, COMMENTED_INDEX], query)
    expect(query).toHaveBeenCalledTimes(2)
    expect(summary).toEqual({ ran: 2, skipped: 0 })
  })
})
