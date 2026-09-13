import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetSessionParseCacheForTests } from '../ai-vault/session-scanner-parse-cache'
import { resetTranscriptConsumersForTests } from '../ai-vault/session-transcript-consumers'
import { installInProcessSessionSearchService } from './session-search-in-process-service'
import {
  openSessionSearchIndexerHarness,
  type SessionSearchIndexerHarness
} from './session-search-indexer-test-fixture'
import { searchSessionService } from './session-search-service-registry'
import { resetSessionSearchPolicyForTests } from './session-search-policy'
import { resetSessionSearchServiceInitForTests } from './session-search-service-init'

/**
 * Every host that answers a search has to register a service, or its answer is
 * `no-service` — which means "this host does not have the feature", not "it is
 * off". Two halves: the installers really register, and each host's boot module
 * really calls the installer that suits it.
 */

const updateSessionSearchInService = vi.hoisted(() => vi.fn())
vi.mock('../ai-vault/session-scanner-service-spawn', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateSessionSearchInService
}))

const ROOT = join(import.meta.dirname, '..', '..', '..')

let harness: SessionSearchIndexerHarness
let installed: { dispose(): void } | null

beforeEach(async () => {
  resetSessionParseCacheForTests()
  resetTranscriptConsumersForTests()
  updateSessionSearchInService.mockClear()
  harness = await openSessionSearchIndexerHarness('ss-registration')
  installed = null
})

afterEach(async () => {
  installed?.dispose()
  const { setSessionSearchService } = await import('./session-search-service-registry')
  setSessionSearchService(null)
  resetSessionSearchPolicyForTests()
  resetSessionSearchServiceInitForTests()
  resetTranscriptConsumersForTests()
  resetSessionParseCacheForTests()
  await harness.cleanup()
})

it('answers no-service until a host registers one', async () => {
  expect(await searchSessionService({ query: 'ledger' }, 'ipc')).toEqual({
    kind: 'unavailable',
    reason: 'no-service'
  })
})

it('registers the desktop service and pushes the stored policy at boot', async () => {
  const { installChildSessionSearchService } = await import('./session-search-enablement')
  installChildSessionSearchService({
    dataRoot: harness.root,
    getSettings: () => ({ aiVaultSearch: { enabled: true, historyDays: 30 } })
  })

  expect(await searchSessionService({ query: 'ledger' }, 'ipc')).not.toEqual({
    kind: 'unavailable',
    reason: 'no-service'
  })
  await vi.waitFor(() => expect(updateSessionSearchInService).toHaveBeenCalledTimes(1))
  expect(updateSessionSearchInService.mock.calls[0]?.[0]).toMatchObject({
    settings: { enabled: true, historyDays: 30 },
    databasePath: join(harness.root, 'ai-vault', 'session-search.sqlite')
  })
})

it('forwards only a real settings change to the child', async () => {
  const { applySessionSearchSettingsChange, installChildSessionSearchService } =
    await import('./session-search-enablement')
  installChildSessionSearchService({
    dataRoot: harness.root,
    getSettings: () => ({ aiVaultSearch: { enabled: false, historyDays: null } })
  })
  await vi.waitFor(() => expect(updateSessionSearchInService).toHaveBeenCalledTimes(1))

  applySessionSearchSettingsChange(
    { aiVaultSearch: { enabled: false, historyDays: null } },
    { aiVaultSearch: { enabled: false, historyDays: null } }
  )
  expect(updateSessionSearchInService).toHaveBeenCalledTimes(1)

  applySessionSearchSettingsChange(
    { aiVaultSearch: { enabled: false, historyDays: null } },
    { aiVaultSearch: { enabled: true, historyDays: null } }
  )
  await vi.waitFor(() => expect(updateSessionSearchInService).toHaveBeenCalledTimes(2))
})

it('registers an in-process service for a host with no scanner child', async () => {
  installed = installInProcessSessionSearchService({
    dataRoot: harness.root,
    roots: harness.roots,
    settings: { enabled: false, historyDays: null }
  })
  expect(installed).not.toBeNull()

  // Off, not absent: the caller can tell consent from a host that lacks the feature.
  expect(await searchSessionService({ query: 'ledger' }, 'relay')).toEqual({
    kind: 'unavailable',
    reason: 'disabled'
  })

  installed?.dispose()
  installed = null
  expect(await searchSessionService({ query: 'ledger' }, 'relay')).toEqual({
    kind: 'unavailable',
    reason: 'no-service'
  })
})

// The behavioural tests above prove the installers register; these prove each
// host's boot path reaches one, which no unit of either module can show.
it.each([
  [
    'desktop main',
    'src/main/ipc/register-core-handlers/register-core-handlers.ts',
    'installChildSessionSearchService'
  ],
  ['orcad', 'src/main/orcad/orcad-session-search.ts', 'installInProcessSessionSearchService'],
  [
    'the relay daemon',
    'src/relay/relay-runtime-services.ts',
    'installInProcessSessionSearchService'
  ]
])('boots %s with a registered session search service', (_host, file, installer) => {
  const source = readFileSync(join(ROOT, file), 'utf8')
  expect(source).toContain(installer)
  expect(source).toMatch(new RegExp(`${installer}\\(\\{`))
})
