import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AiVaultSearchResponse, AiVaultSearchStatus } from '../../shared/ai-vault-search-types'
import {
  openSessionSearchIndexerHarness,
  writeClaudeTranscript,
  type SessionSearchIndexerHarness
} from '../ai-vault-search/session-search-indexer-test-fixture'
import {
  AI_VAULT_SERVICE_PROTOCOL_VERSION,
  type AiVaultServiceChildMessage,
  type AiVaultSessionSearchInit
} from './session-scanner-service-protocol'

/**
 * The child, booted the way a spawn boots it: an init frame and messages, with
 * no renderer, no Electron and no scan request. What this proves is that consent
 * alone constructs the indexer and that every search answer crosses the protocol.
 */

const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

let harness: SessionSearchIndexerHarness
let originalSend: typeof process.send
const sent: AiVaultServiceChildMessage[] = []
let nextId = 1

function emit(message: unknown): void {
  process.emit('message', message as never, undefined as never)
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const id = nextId++
  emit({ type: 'request', id, ...body })
  const reply = await vi.waitFor(() => {
    const found = sent.find((message) => 'id' in message && message.id === id)
    expect(found).toBeDefined()
    return found!
  })
  if (reply.type === 'error') {
    throw new Error(reply.message)
  }
  return (reply as unknown as { value: T }).value
}

function searchInit(enabled: boolean): AiVaultSessionSearchInit {
  return {
    databasePath: harness.databasePath,
    settings: { enabled, historyDays: null },
    roots: harness.roots
  }
}

beforeAll(async () => {
  harness = await openSessionSearchIndexerHarness('ss-child')
  await writeClaudeTranscript(
    join(harness.claudeProjectDir, `${SESSION_ID}.jsonl`),
    ['a distinctive conversation'],
    SESSION_ID
  )
  originalSend = process.send
  process.send = ((message: AiVaultServiceChildMessage) => {
    sent.push(message)
    return true
  }) as typeof process.send
  await import('./session-scanner-service-entry')
  emit({
    type: 'init',
    protocol: AI_VAULT_SERVICE_PROTOCOL_VERSION,
    sessionParseCache: null,
    sessionSearch: searchInit(true)
  })
  await vi.waitFor(() => expect(sent.some((message) => message.type === 'ready')).toBe(true))
})

afterAll(async () => {
  emit({ type: 'sessionSearch', init: searchInit(false) })
  process.send = originalSend
  await harness.cleanup()
})

it('reports the indexer phase and a live generation over the protocol', async () => {
  const status = await vi.waitFor(async () => {
    const value = await call<AiVaultSearchStatus>({ operation: 'searchStatus' })
    expect(value.filesIndexed).toBeGreaterThan(0)
    return value
  })
  expect(status.enabled).toBe(true)
  expect(status.phase).toBe('current')
  expect(status.generation).toBeGreaterThan(0)
  expect(existsSync(harness.databasePath)).toBe(true)
})

it('answers a search and a reconcile over the protocol', async () => {
  expect(await call({ operation: 'searchReconcile' })).toBeNull()
  const response = await call<AiVaultSearchResponse>({
    operation: 'searchSessions',
    request: { query: 'distinctive' }
  })
  expect(response.kind).toBe('results')
  if (response.kind === 'results') {
    expect(response.hits.map((hit) => hit.sessionId)).toEqual([SESSION_ID])
  }
})

it('answers disabled once consent is withdrawn, without a respawn', async () => {
  emit({ type: 'sessionSearch', init: searchInit(false) })
  expect(await call({ operation: 'searchSessions', request: { query: 'distinctive' } })).toEqual({
    kind: 'unavailable',
    reason: 'disabled'
  })
  expect(await call<AiVaultSearchStatus>({ operation: 'searchStatus' })).toMatchObject({
    enabled: false,
    phase: 'idle'
  })
  // Re-consenting reuses the index that was left on disk rather than rebuilding it.
  emit({ type: 'sessionSearch', init: searchInit(true) })
  const response = await call<AiVaultSearchResponse>({
    operation: 'searchSessions',
    request: { query: 'distinctive' }
  })
  expect(response.kind).toBe('results')
})
