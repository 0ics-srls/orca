import { unavailableSessionSearchStatus } from '../../shared/ai-vault-search-client'
import { AiVaultSearchRequestSchema } from '../../shared/ai-vault-search-contract'
import { SessionSearchInstance } from '../ai-vault-search/session-search-instance'
import {
  sameSessionSearchRoots,
  type SessionSearchScanRoots
} from '../ai-vault-search/session-search-scan-roots'
import { sessionSearchSqliteAvailable } from '../ai-vault-search/session-search-sqlite-support'
import type {
  AiVaultServiceRequest,
  AiVaultServiceResultValue,
  AiVaultSessionSearchInit
} from './session-scanner-service-protocol'

type SearchOperation = Extract<
  AiVaultServiceRequest,
  { operation: 'searchSessions' | 'searchStatus' | 'searchReconcile' }
>

/**
 * The scanner-service child's half of session search.
 *
 * Why the child and not the parent: the transcript reader runs here, so the
 * index consumer has to as well — one process reads a transcript once and both
 * the session list and the index see that read. Main, the CLI and a remote
 * server never open the database; they ask over this protocol.
 */
export class SessionScannerServiceSearch {
  private instance: SessionSearchInstance | null = null
  private databasePath: string | null = null
  private roots: SessionSearchScanRoots | null = null

  /** Applied at init and again on every settings change; both are close-and-construct. */
  apply(init: AiVaultSessionSearchInit): void {
    if (!sessionSearchSqliteAvailable()) {
      return
    }
    if (this.instance && this.databasePath !== init.databasePath) {
      // A data root cannot move under a running process, so this is a caller bug
      // rather than a case to support: close the old one before it writes there.
      this.close()
    }
    if (this.instance && this.roots && !sameSessionSearchRoots(this.roots, init.roots)) {
      // The indexer's roots are fixed at construction, and the parent re-resolves
      // them on every push: a distro or Codex home that appeared since spawn only
      // enters the window if the pair is rebuilt around the new set.
      this.close()
    }
    this.databasePath = init.databasePath
    this.roots = init.roots
    this.instance ??= new SessionSearchInstance({
      databasePath: init.databasePath,
      roots: init.roots
    })
    this.instance.apply(init.settings)
  }

  handles(request: AiVaultServiceRequest): request is SearchOperation {
    return (
      request.operation === 'searchSessions' ||
      request.operation === 'searchStatus' ||
      request.operation === 'searchReconcile'
    )
  }

  async execute(request: SearchOperation): Promise<AiVaultServiceResultValue> {
    const instance = this.instance
    if (request.operation === 'searchStatus') {
      return {
        operation: 'searchStatus',
        value: instance?.status() ?? unavailableSessionSearchStatus()
      }
    }
    if (request.operation === 'searchReconcile') {
      await instance?.reconcile()
      return { operation: 'searchReconcile', value: null }
    }
    return {
      operation: 'searchSessions',
      value: instance
        ? await instance.search(AiVaultSearchRequestSchema.parse(request.request))
        : { kind: 'unavailable', reason: 'disabled' }
    }
  }

  close(): void {
    this.instance?.close()
    this.instance = null
    this.databasePath = null
    this.roots = null
  }
}
