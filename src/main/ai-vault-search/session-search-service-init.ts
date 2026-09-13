import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { AiVaultSessionSearchInit } from '../ai-vault/session-scanner-service-protocol'
import { localAiVaultScanRoots } from '../ai-vault/cached-session-list'
import { sessionSearchDatabasePath } from './session-search-database-path'
import { sessionSearchPolicy } from './session-search-policy'
import type { SessionSearchScanRoots } from './session-search-scan-roots'

// Captured once from the composition root's data path, like the parse cache:
// every export is inert until then, so no test or early import can index.
let databasePath: string | null = null
let roots: SessionSearchScanRoots = { executionHostId: LOCAL_EXECUTION_HOST_ID }

export function installSessionSearchDataRoot(dataRoot: string): void {
  databasePath = sessionSearchDatabasePath(dataRoot)
}

/**
 * Re-resolve the trees the index walks. Async because a WSL home enumeration is,
 * which is also why it is not folded into the init frame the child reads on spawn.
 */
export async function refreshSessionSearchScanRoots(): Promise<void> {
  roots = await localAiVaultScanRoots()
}

/** Read at every spawn and every settings change; null before the data root is installed. */
export function sessionSearchServiceInit(): AiVaultSessionSearchInit | null {
  return databasePath ? { databasePath, settings: sessionSearchPolicy(), roots } : null
}

export function resetSessionSearchServiceInitForTests(): void {
  databasePath = null
  roots = { executionHostId: LOCAL_EXECUTION_HOST_ID }
}
