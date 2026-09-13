import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  openSessionSearchIndexerHarness,
  writeMessageGraphTranscript,
  type SessionSearchIndexerHarness
} from '../ai-vault-search/session-search-indexer-test-fixture'
import { SessionSearchInstance } from '../ai-vault-search/session-search-instance'
import type { SessionSearchScanRoots } from '../ai-vault-search/session-search-scan-roots'
import { resetSessionParseCacheForTests } from './session-scanner-parse-cache'
import type { AiVaultSessionSearchInit } from './session-scanner-service-protocol'
import { SessionScannerServiceSearch } from './session-scanner-service-search'
import { resetTranscriptConsumersForTests } from './session-transcript-consumers'

/**
 * The parent re-resolves scan roots on every policy push, precisely so a WSL
 * distro or extra Codex home that appeared since the child spawned enters the
 * window. The indexer is immutable, so the only way that root is walked is a
 * rebuild of the pair around the new set — and an unchanged set must not rebuild.
 */

let harness: SessionSearchIndexerHarness
let subject: SessionScannerServiceSearch
let spawnRoot: string
let lateRoot: string
let spawnRoots: SessionSearchScanRoots

beforeEach(async () => {
  resetSessionParseCacheForTests()
  resetTranscriptConsumersForTests()
  harness = await openSessionSearchIndexerHarness('ss-service-roots')
  subject = new SessionScannerServiceSearch()
  const { openclawLegacyStateDir, ...rest } = harness.roots
  spawnRoot = harness.roots.openclawStateDir ?? ''
  lateRoot = openclawLegacyStateDir ?? ''
  spawnRoots = rest
})

afterEach(async () => {
  subject.close()
  vi.restoreAllMocks()
  resetTranscriptConsumersForTests()
  resetSessionParseCacheForTests()
  await harness.cleanup()
})

function init(roots: SessionSearchScanRoots): AiVaultSessionSearchInit {
  return {
    databasePath: harness.databasePath,
    settings: { enabled: true, historyDays: null },
    roots
  }
}

/** OpenClaw reads `<stateDir>/agents/**` and keeps only paths through `sessions`. */
function openclawTranscript(stateDir: string, name: string): string {
  return join(stateDir, 'agents', 'main', 'sessions', `${name}.jsonl`)
}

async function sessionsMatching(term: string): Promise<string[]> {
  const reply = await subject.execute({
    type: 'request',
    id: 1,
    operation: 'searchSessions',
    request: { query: term }
  })
  if (reply.operation !== 'searchSessions' || reply.value.kind !== 'results') {
    throw new Error(`expected results, got ${JSON.stringify(reply)}`)
  }
  return reply.value.hits.map((hit) => hit.sessionId).sort()
}

async function indexedSessions(term: string, expected: string[]): Promise<void> {
  await vi.waitFor(
    async () => {
      await subject.execute({ type: 'request', id: 2, operation: 'searchReconcile' })
      expect(await sessionsMatching(term)).toEqual(expected)
    },
    { timeout: 20_000 }
  )
}

it('rebuilds the index around a root that appeared after the child spawned', async () => {
  await writeMessageGraphTranscript(openclawTranscript(spawnRoot, 'early-session'), [
    'a conversation in a root the spawn already knew'
  ])
  await writeMessageGraphTranscript(openclawTranscript(lateRoot, 'late-session'), [
    'a conversation in a distro that started later'
  ])

  subject.apply(init(spawnRoots))
  await indexedSessions('conversation', ['early-session'])

  subject.apply(init(harness.roots))
  await indexedSessions('conversation', ['early-session', 'late-session'])
})

it('leaves the live pair in place when the same roots are pushed again', async () => {
  await writeMessageGraphTranscript(openclawTranscript(spawnRoot, 'early-session'), [
    'a conversation in a root the spawn already knew'
  ])
  subject.apply(init(harness.roots))
  await indexedSessions('conversation', ['early-session'])

  // A re-resolved root set is a new object every time; only a structural change
  // may close the pair, so re-saving the same value never restarts the index.
  const close = vi.spyOn(SessionSearchInstance.prototype, 'close')
  subject.apply(init({ ...harness.roots }))

  expect(close).not.toHaveBeenCalled()
  await indexedSessions('conversation', ['early-session'])
})
