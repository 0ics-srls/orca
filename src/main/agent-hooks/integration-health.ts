import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type IntegrationArtifactHealth = 'missing' | 'current' | 'stale' | 'unknown'
export type IntegrationLoaderHealth = 'supported' | 'loaded' | 'rejected' | 'unknown'
export type IntegrationDeliveryHealth = 'observed' | 'failed' | 'unobserved' | 'unknown'

export type IntegrationHealthRecord = {
  integration: string
  host: string
  scope: string
  artifact: IntegrationArtifactHealth
  loader: IntegrationLoaderHealth
  delivery: IntegrationDeliveryHealth
  artifactId?: string
  digest?: string
  byteLength?: number
  version?: string
  updatedAt: number
  expiresAt: number
}

export type IntegrationHealthStoreOptions = {
  filePath: string
  now?: () => number
  ttlMs?: number
  maxRecords?: number
}

type PersistedHealth = { version: 1; records: IntegrationHealthRecord[] }

function isPersistedHealth(value: unknown): value is PersistedHealth {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only reads optional discriminator fields after object/null guard.
  const candidate = value as { version?: unknown; records?: unknown }
  return candidate.version === 1 && Array.isArray(candidate.records)
}

/** Durable diagnostics for adapter artifacts; this is not agent status authority. */
export class IntegrationHealthStore {
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxRecords: number
  private readonly records = new Map<string, IntegrationHealthRecord>()
  private loaded = false

  constructor(private readonly options: IntegrationHealthStoreOptions) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000
    this.maxRecords = options.maxRecords ?? 256
  }

  private key(record: Pick<IntegrationHealthRecord, 'integration' | 'host' | 'scope'>): string {
    return `${record.integration}\u0000${record.host}\u0000${record.scope}`
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return
    }
    this.loaded = true
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.options.filePath, 'utf8'))
      if (!isPersistedHealth(parsed)) {
        return
      }
      const now = this.now()
      for (const record of parsed.records) {
        if (
          !record ||
          typeof record !== 'object' ||
          typeof record.expiresAt !== 'number' ||
          record.expiresAt <= now
        ) {
          continue
        }
        this.records.set(this.key(record), record)
      }
    } catch {
      // Missing or corrupt diagnostics must never block integration launch.
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.options.filePath), { recursive: true })
    const tmp = join(dirname(this.options.filePath), `.${randomUUID()}.tmp`)
    try {
      writeFileSync(
        tmp,
        `${JSON.stringify({ version: 1, records: [...this.records.values()] } satisfies PersistedHealth)}\n`
      )
      renameSync(tmp, this.options.filePath)
    } finally {
      if (existsSync(tmp)) {
        try {
          unlinkSync(tmp)
        } catch {
          // Best effort.
        }
      }
    }
  }

  record(
    record: Omit<IntegrationHealthRecord, 'updatedAt' | 'expiresAt'>
  ): IntegrationHealthRecord {
    this.ensureLoaded()
    const now = this.now()
    const next: IntegrationHealthRecord = { ...record, updatedAt: now, expiresAt: now + this.ttlMs }
    this.records.set(this.key(next), next)
    while (this.records.size > this.maxRecords) {
      const oldest = [...this.records.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]
      if (!oldest) {
        break
      }
      this.records.delete(oldest[0])
    }
    try {
      this.persist()
    } catch {
      // Diagnostics are best effort.
    }
    return next
  }

  recordArtifact(input: {
    integration: string
    host: string
    scope: string
    bytes?: string | Uint8Array
    version?: string
    loader?: IntegrationLoaderHealth
    delivery?: IntegrationDeliveryHealth
  }): IntegrationHealthRecord {
    const bytes =
      input.bytes === undefined
        ? undefined
        : typeof input.bytes === 'string'
          ? Buffer.from(input.bytes)
          : Buffer.from(input.bytes)
    const record: Omit<IntegrationHealthRecord, 'updatedAt' | 'expiresAt'> = {
      integration: input.integration,
      host: input.host,
      scope: input.scope,
      artifact: bytes === undefined ? 'unknown' : 'current',
      loader: input.loader ?? 'unknown',
      delivery: input.delivery ?? 'unobserved',
      version: input.version
    }
    if (bytes !== undefined) {
      Object.assign(record, {
        artifactId: `${input.integration}:${input.scope}`,
        digest: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.byteLength
      })
    }
    return this.record(record)
  }

  get(integration: string, host: string, scope: string): IntegrationHealthRecord | undefined {
    this.ensureLoaded()
    const record = this.records.get(this.key({ integration, host, scope }))
    if (!record || record.expiresAt <= this.now()) {
      if (record) {
        this.records.delete(this.key(record))
      }
      return undefined
    }
    return record
  }

  markLoader(
    integration: string,
    host: string,
    scope: string,
    loader: IntegrationLoaderHealth
  ): IntegrationHealthRecord | undefined {
    const current = this.get(integration, host, scope)
    if (!current) {
      return undefined
    }
    return this.record({ ...current, loader })
  }

  markDelivery(
    integration: string,
    host: string,
    scope: string,
    delivery: IntegrationDeliveryHealth
  ): IntegrationHealthRecord | undefined {
    const current = this.get(integration, host, scope)
    if (!current) {
      return undefined
    }
    return this.record({ ...current, delivery })
  }

  markArtifactStale(
    integration: string,
    host: string,
    scope: string
  ): IntegrationHealthRecord | undefined {
    const current = this.get(integration, host, scope)
    if (!current) {
      return undefined
    }
    return this.record({ ...current, artifact: 'stale' })
  }

  snapshot(): readonly IntegrationHealthRecord[] {
    this.ensureLoaded()
    const now = this.now()
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(key)
      }
    }
    return [...this.records.values()]
  }
}

export function createIntegrationHealthStore(filePath: string): IntegrationHealthStore {
  return new IntegrationHealthStore({ filePath })
}
