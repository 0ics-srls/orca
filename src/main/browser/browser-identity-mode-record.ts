import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { durableWriteTempPath, writeFileDurableSync } from '../durable-file-write'
import type {
  BrowserIdentityModeStatus,
  BrowserIdentityModeSetResult,
  BrowserIdentityModeSnapshot,
  BrowserUserAgentMode
} from '../../shared/browser-user-agent-mode'

/**
 * The browser's identity is one process-wide decision, not a per-profile one.
 *
 * Electron resolves worker identity from a single process-global default, so two coherent
 * identities cannot coexist in one process: a per-profile native mode leaves documents on one
 * identity and every worker request on the other, which is a sharper bot signal than either
 * alone. The choice therefore lives here, is read before `ready`, and applies to the whole app.
 *
 * Both identities are load-bearing, which is why this is a choice and not a constant. Measured
 * across four origins, five repetitions each: the cleaned identity clears an embedded Turnstile
 * widget and WhatsApp's browser check while the native identity is refused by both; the native
 * identity clears a full-page Cloudflare interstitial that the cleaned identity never clears.
 *
 * Read with `readFileSync` rather than through the settings store because the store loads long
 * after `ready`, and by then every session and worker has already taken its default.
 */
export const BROWSER_IDENTITY_MODE_FILE = 'browser-identity-mode.json'
export const BROWSER_IDENTITY_MODE_VERSION = 1

export type BrowserIdentityModeRecord = {
  version: typeof BROWSER_IDENTITY_MODE_VERSION
  mode: BrowserUserAgentMode
  explicitSelection: boolean
  migrationNoticePending: boolean
}

type HealthyBrowserIdentityModeReadResult = {
  state: 'missing' | 'valid'
  appliedMode: BrowserUserAgentMode
  configuredMode: BrowserUserAgentMode
  explicitSelection: boolean
  migrationNoticePending: boolean
}

type UnhealthyBrowserIdentityModeReadResult = {
  state: 'corrupt' | 'future' | 'unreadable'
  appliedMode: 'clean'
  configuredMode: null
  explicitSelection: null
  migrationNoticePending: null
}

export type BrowserIdentityModeReadResult =
  | HealthyBrowserIdentityModeReadResult
  | UnhealthyBrowserIdentityModeReadResult

type BrowserIdentityModeStore = {
  userDataPath: string
  snapshot: BrowserIdentityModeSnapshot
}

let modeStore: BrowserIdentityModeStore | null = null
let writeQueue: Promise<void> = Promise.resolve()
const snapshotListeners = new Set<(snapshot: BrowserIdentityModeSnapshot) => void>()
let migrationNoticeDegraded = false
let launchMigrationNoticePending = false

export function browserIdentityModeRecordPath(userDataPath: string): string {
  return join(userDataPath, BROWSER_IDENTITY_MODE_FILE)
}

function parseRecord(raw: string): BrowserIdentityModeReadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return unhealthyResult('corrupt')
  }
  if (!parsed || typeof parsed !== 'object') {
    return unhealthyResult('corrupt')
  }
  const version = Reflect.get(parsed, 'version')
  if (typeof version === 'number' && version > BROWSER_IDENTITY_MODE_VERSION) {
    return unhealthyResult('future')
  }
  const mode = Reflect.get(parsed, 'mode')
  const explicitSelection = Reflect.get(parsed, 'explicitSelection')
  const migrationNoticePending = Reflect.get(parsed, 'migrationNoticePending')
  if (
    version !== BROWSER_IDENTITY_MODE_VERSION ||
    (mode !== 'clean' && mode !== 'native') ||
    typeof explicitSelection !== 'boolean' ||
    typeof migrationNoticePending !== 'boolean'
  ) {
    return unhealthyResult('corrupt')
  }
  return {
    state: 'valid',
    appliedMode: mode,
    configuredMode: mode,
    explicitSelection,
    migrationNoticePending
  }
}

function unhealthyResult(
  state: UnhealthyBrowserIdentityModeReadResult['state']
): UnhealthyBrowserIdentityModeReadResult {
  return {
    state,
    appliedMode: 'clean',
    configuredMode: null,
    explicitSelection: null,
    migrationNoticePending: null
  }
}

/** Reads the process identity synchronously before Electron readiness. */
export function readBrowserIdentityModeRecord(
  userDataPath: string
): BrowserIdentityModeReadResult {
  try {
    return parseRecord(readFileSync(browserIdentityModeRecordPath(userDataPath), 'utf-8'))
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
      return {
        state: 'missing',
        appliedMode: 'clean',
        configuredMode: 'clean',
        explicitSelection: false,
        migrationNoticePending: false
      }
    }
    return unhealthyResult('unreadable')
  }
}

function writeBrowserIdentityModeRecord(
  userDataPath: string,
  record: BrowserIdentityModeRecord
): void {
  const filePath = browserIdentityModeRecordPath(userDataPath)
  writeFileDurableSync(
    durableWriteTempPath(filePath),
    filePath,
    `${JSON.stringify(record, null, 2)}\n`
  )
}

function snapshotForRead(result: BrowserIdentityModeReadResult): BrowserIdentityModeSnapshot {
  return { ...result, restartRequired: false }
}

export function initializeBrowserIdentityModeStore(
  userDataPath: string
): BrowserIdentityModeSnapshot {
  if (modeStore) {
    throw new Error('Browser identity mode store was already initialized')
  }
  const snapshot = snapshotForRead(readBrowserIdentityModeRecord(userDataPath))
  modeStore = { userDataPath, snapshot }
  return snapshot
}

function requireModeStore(): BrowserIdentityModeStore {
  if (!modeStore) {
    throw new Error('Browser identity mode store is not initialized')
  }
  return modeStore
}

export function getBrowserIdentityModeSnapshot(): BrowserIdentityModeSnapshot {
  return requireModeStore().snapshot
}

export function getBrowserIdentityMigrationNotice(): { degraded: boolean } | null {
  const snapshot = requireModeStore().snapshot
  return launchMigrationNoticePending || snapshot.migrationNoticePending === true
    ? { degraded: migrationNoticeDegraded }
    : null
}

export function getBrowserIdentityModeStatus(): BrowserIdentityModeStatus {
  return {
    identity: getBrowserIdentityModeSnapshot(),
    migrationNotice: getBrowserIdentityMigrationNotice()
  }
}

function notifySnapshotListeners(snapshot: BrowserIdentityModeSnapshot): void {
  for (const listener of snapshotListeners) {
    try {
      listener(snapshot)
    } catch (error) {
      console.error('[browser-identity] Snapshot listener failed:', error)
    }
  }
}

export function onBrowserIdentityModeSnapshotChanged(
  listener: (snapshot: BrowserIdentityModeSnapshot) => void
): () => void {
  snapshotListeners.add(listener)
  return () => snapshotListeners.delete(listener)
}

function enqueueWrite<T>(operation: () => T): Promise<T> {
  const pending = writeQueue.then(operation, operation)
  writeQueue = pending.then(
    () => undefined,
    () => undefined
  )
  return pending
}

export function setBrowserIdentityMode(
  mode: BrowserUserAgentMode
): Promise<BrowserIdentityModeSetResult> {
  return enqueueWrite(() => {
    const store = requireModeStore()
    const current = store.snapshot
    if (current.configuredMode === null) {
      return {
        ok: false,
        error: {
          code: 'browser_identity_reset_required',
          message: `Browser identity data is ${current.state}; reset it before choosing a mode.`
        },
        identity: current
      }
    }
    const record: BrowserIdentityModeRecord = {
      version: BROWSER_IDENTITY_MODE_VERSION,
      mode,
      explicitSelection: true,
      migrationNoticePending: false
    }
    try {
      writeBrowserIdentityModeRecord(store.userDataPath, record)
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'browser_identity_write_failed',
          message: error instanceof Error ? error.message : String(error)
        },
        identity: current
      }
    }
    const identity: BrowserIdentityModeSnapshot = {
      state: 'valid',
      appliedMode: current.appliedMode,
      configuredMode: mode,
      explicitSelection: true,
      migrationNoticePending: false,
      restartRequired: mode !== current.appliedMode
    }
    store.snapshot = identity
    launchMigrationNoticePending = false
    migrationNoticeDegraded = false
    notifySnapshotListeners(identity)
    return { ok: true, identity }
  })
}

export function markBrowserIdentityMigrationNoticePending(
  userDataPath: string,
  degraded: boolean
): Promise<boolean> {
  return enqueueWrite(() => {
    if (!modeStore) {
      initializeBrowserIdentityModeStore(userDataPath)
    }
    const store = requireModeStore()
    if (store.userDataPath !== userDataPath) {
      throw new Error('Browser identity mode store userData path changed')
    }
    const current = store.snapshot
    launchMigrationNoticePending = true
    migrationNoticeDegraded ||= degraded
    if (current.configuredMode === null) {
      return false
    }
    const record: BrowserIdentityModeRecord = {
      version: BROWSER_IDENTITY_MODE_VERSION,
      mode: current.configuredMode,
      explicitSelection: current.explicitSelection,
      migrationNoticePending: true
    }
    try {
      writeBrowserIdentityModeRecord(userDataPath, record)
    } catch (error) {
      console.error('[browser-identity] Could not persist retired profile notice:', error)
      return false
    }
    store.snapshot = {
      state: 'valid',
      appliedMode: current.appliedMode,
      configuredMode: current.configuredMode,
      explicitSelection: current.explicitSelection,
      migrationNoticePending: true,
      restartRequired: current.restartRequired
    }
    notifySnapshotListeners(store.snapshot)
    return true
  })
}

export function resetBrowserIdentityModeStoreForTests(): void {
  modeStore = null
  writeQueue = Promise.resolve()
  snapshotListeners.clear()
  migrationNoticeDegraded = false
  launchMigrationNoticePending = false
}
