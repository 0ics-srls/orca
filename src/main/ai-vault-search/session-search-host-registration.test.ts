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

const localAiVaultScanRoots = vi.hoisted(() => vi.fn())
vi.mock('../ai-vault/cached-session-list', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  localAiVaultScanRoots
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
  localAiVaultScanRoots.mockReset().mockResolvedValue(harness.roots)
})

afterEach(async () => {
  installed?.dispose()
  vi.useRealTimers()
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
  installed = installChildSessionSearchService({
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
  installed = installChildSessionSearchService({
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

it('refreshes enabled roots periodically and only pushes a changed root set', async () => {
  vi.useFakeTimers()
  const { installChildSessionSearchService } = await import('./session-search-enablement')
  installed = installChildSessionSearchService({
    dataRoot: harness.root,
    getSettings: () => ({ aiVaultSearch: { enabled: true, historyDays: null } })
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(updateSessionSearchInService).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(300_000)
  expect(localAiVaultScanRoots).toHaveBeenCalledTimes(2)
  expect(updateSessionSearchInService).toHaveBeenCalledTimes(1)

  const newRoots = { ...harness.roots, additionalCodexSessionsDirs: [join(harness.root, 'late')] }
  localAiVaultScanRoots.mockResolvedValue(newRoots)
  await vi.advanceTimersByTimeAsync(300_000)
  expect(updateSessionSearchInService).toHaveBeenCalledTimes(2)
  expect(updateSessionSearchInService).toHaveBeenLastCalledWith(
    expect.objectContaining({ roots: newRoots })
  )

  await vi.advanceTimersByTimeAsync(300_000)
  expect(updateSessionSearchInService).toHaveBeenCalledTimes(2)
  installed?.dispose()
  await vi.advanceTimersByTimeAsync(300_000)
  expect(localAiVaultScanRoots).toHaveBeenCalledTimes(4)
})

it('starts root refresh on enable and cancels it on disable', async () => {
  vi.useFakeTimers()
  const { installChildSessionSearchService, applySessionSearchSettingsChange } =
    await import('./session-search-enablement')
  let settings = { aiVaultSearch: { enabled: false, historyDays: null } }
  installed = installChildSessionSearchService({
    dataRoot: harness.root,
    getSettings: () => settings
  })
  await vi.advanceTimersByTimeAsync(300_000)
  expect(localAiVaultScanRoots).toHaveBeenCalledTimes(0)
  const before = settings
  settings = { aiVaultSearch: { enabled: true, historyDays: null } }
  applySessionSearchSettingsChange(before, settings)
  await vi.advanceTimersByTimeAsync(300_000)
  expect(localAiVaultScanRoots).toHaveBeenCalledTimes(2)

  const enabled = settings
  settings = before
  applySessionSearchSettingsChange(enabled, settings)
  await vi.advanceTimersByTimeAsync(300_000)
  expect(localAiVaultScanRoots).toHaveBeenCalledTimes(2)
  expect(updateSessionSearchInService).toHaveBeenLastCalledWith(
    expect.objectContaining({ settings: before.aiVaultSearch })
  )
  expect(vi.getTimerCount()).toBe(0)
})

it('does not push a pending root refresh after disposal', async () => {
  vi.useFakeTimers()
  const { installChildSessionSearchService } = await import('./session-search-enablement')
  installed = installChildSessionSearchService({
    dataRoot: harness.root,
    getSettings: () => ({ aiVaultSearch: { enabled: true, historyDays: null } })
  })
  await vi.advanceTimersByTimeAsync(0)
  const pending = Promise.withResolvers<typeof harness.roots>()
  localAiVaultScanRoots.mockReturnValueOnce(pending.promise)
  await vi.advanceTimersByTimeAsync(300_000)
  installed?.dispose()
  pending.resolve({ ...harness.roots, additionalCodexSessionsDirs: [join(harness.root, 'late')] })
  await vi.advanceTimersByTimeAsync(300_000)
  expect(updateSessionSearchInService).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
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
    'desktop and headless serve',
    'src/main/startup/main-process-runtime-service.ts',
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

it('disables immediately while an enabled root discovery is pending', async () => {
  const { installChildSessionSearchService, applySessionSearchSettingsChange } =
    await import('./session-search-enablement')
  let settings = { aiVaultSearch: { enabled: true, historyDays: null } }
  const pending = Promise.withResolvers<typeof harness.roots>()
  localAiVaultScanRoots.mockReturnValueOnce(pending.promise)
  installed = installChildSessionSearchService({
    dataRoot: harness.root,
    getSettings: () => settings
  })
  const before = settings
  settings = { aiVaultSearch: { enabled: false, historyDays: null } }
  applySessionSearchSettingsChange(before, settings)
  expect(updateSessionSearchInService).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ settings: settings.aiVaultSearch })
  )
  expect(localAiVaultScanRoots).toHaveBeenCalledTimes(1)
  pending.resolve(harness.roots)
  await Promise.resolve()
  await Promise.resolve()
  expect(updateSessionSearchInService).toHaveBeenLastCalledWith(
    expect.objectContaining({ settings: settings.aiVaultSearch })
  )
})
