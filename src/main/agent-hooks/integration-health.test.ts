import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { IntegrationHealthStore } from './integration-health'

describe('IntegrationHealthStore', () => {
  it('persists bounded artifact identity and reloads it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'integration-health-'))
    const filePath = join(dir, 'health.json')
    const store = new IntegrationHealthStore({ filePath, now: () => 1000, maxRecords: 1 })
    const one = store.recordArtifact({
      integration: 'auggie',
      host: 'local',
      scope: 'settings',
      bytes: 'one'
    })
    expect(one.digest).toHaveLength(64)
    expect(one.byteLength).toBe(3)
    store.recordArtifact({ integration: 'opencode', host: 'local', scope: 'pane', bytes: 'two' })
    expect(store.snapshot()).toHaveLength(1)
    expect(JSON.parse(readFileSync(filePath, 'utf8')).version).toBe(1)
    expect(
      new IntegrationHealthStore({ filePath, now: () => 1000 }).get('opencode', 'local', 'pane')
        ?.artifact
    ).toBe('current')
  })

  it('expires records so durable obligations have an exit', () => {
    let now = 100
    const store = new IntegrationHealthStore({
      filePath: join(mkdtempSync(join(tmpdir(), 'integration-health-')), 'h.json'),
      now: () => now,
      ttlMs: 10
    })
    store.recordArtifact({ integration: 'auggie', host: 'remote', scope: 'settings', bytes: 'x' })
    now = 111
    expect(store.snapshot()).toEqual([])
  })
})
