import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import type { BrowserSessionUserAgentMode } from '../../shared/browser-workspace-types'

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
  mode: BrowserSessionUserAgentMode
  /** Profiles that carried the retired per-profile `native` mode, so the browser can say so once. */
  migratedNativeProfileIds?: string[]
  /** Cleared once the user has been told their per-profile choice no longer exists. */
  migrationNoticePending?: boolean
}

export function browserIdentityModeRecordPath(userDataPath: string): string {
  return join(userDataPath, BROWSER_IDENTITY_MODE_FILE)
}

function parseRecord(raw: string): BrowserIdentityModeRecord | null {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: JSON.parse is untyped; every member is checked below and an unrecognised shape returns null.
  const parsed = JSON.parse(raw) as Partial<BrowserIdentityModeRecord>
  if (parsed.version !== BROWSER_IDENTITY_MODE_VERSION) {
    return null
  }
  if (parsed.mode !== 'clean' && parsed.mode !== 'native') {
    return null
  }
  return {
    version: BROWSER_IDENTITY_MODE_VERSION,
    mode: parsed.mode,
    migratedNativeProfileIds: Array.isArray(parsed.migratedNativeProfileIds)
      ? parsed.migratedNativeProfileIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    migrationNoticePending: parsed.migrationNoticePending === true ? true : undefined
  }
}

/** Absent, unreadable, or unrecognised all mean `clean` — the default that keeps imported cookies alive. */
export function readBrowserIdentityModeRecord(userDataPath: string): BrowserIdentityModeRecord {
  try {
    const parsed = parseRecord(readFileSync(browserIdentityModeRecordPath(userDataPath), 'utf-8'))
    return parsed ?? { version: BROWSER_IDENTITY_MODE_VERSION, mode: 'clean' }
  } catch {
    return { version: BROWSER_IDENTITY_MODE_VERSION, mode: 'clean' }
  }
}

export function writeBrowserIdentityModeRecord(
  userDataPath: string,
  record: BrowserIdentityModeRecord
): void {
  writeFileAtomically(
    browserIdentityModeRecordPath(userDataPath),
    `${JSON.stringify(record, null, 2)}\n`
  )
}
