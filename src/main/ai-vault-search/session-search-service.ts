import type {
  AiVaultSearchRequest,
  AiVaultSearchResponse,
  AiVaultSearchStatus
} from '../../shared/ai-vault-search-types'
import type { SessionSearchEngine } from './session-search-engine'
import type { SessionSearchIndexer } from './session-search-indexer'
import { SessionSearchCursorError } from './session-search-page-cursor'

/**
 * Paths a host resolved from a scope identity, handed to the engine beside the
 * request rather than inside `filters.scopePaths`.
 *
 * Why not that field: it is a wire field, capped at 64 entries for the clients
 * that fill it in by hand. A project whose worktrees do not share one managed
 * directory resolves to one path per worktree, and 100 of them would be refused
 * by the very schema the request is re-parsed with inside the scanner child.
 * These paths never cross a wire — the host that resolved them is the host that
 * searches — so no cap applies to them.
 */
export type SessionSearchHostScopePaths = readonly string[]

export type SessionSearchService = {
  search(
    req: AiVaultSearchRequest,
    hostScopePaths?: SessionSearchHostScopePaths
  ): Promise<AiVaultSearchResponse>
  status(): Promise<AiVaultSearchStatus>
  reconcile(): Promise<void>
}

export function createSessionSearchService({
  engine,
  indexer
}: {
  engine: SessionSearchEngine
  indexer: Pick<SessionSearchIndexer, 'status' | 'reconcile'>
}): SessionSearchService {
  return {
    reconcile: () => indexer.reconcile({ full: true }),
    status: async () => ({ enabled: true, ...indexer.status(), generation: engine.generation() }),
    search: async (request, hostScopePaths) => {
      if (request.cursor === '') {
        return { kind: 'malformed-cursor' }
      }
      try {
        const result = engine.search(
          hostScopePaths
            ? { ...request, filters: { ...request.filters, scopePaths: hostScopePaths } }
            : request
        )
        return {
          kind: 'results',
          hits: result.hits.map(
            ({
              filePath,
              codexHome,
              source,
              evidence,
              resumeCommand,
              duplicateCount: _duplicateCount,
              ...hit
            }) => ({
              ...hit,
              source: { presence: source, filePath, ...(codexHome === null ? {} : { codexHome }) },
              evidence:
                evidence === null
                  ? null
                  : {
                      snippet: evidence.snippet,
                      role: evidence.role,
                      timestamp: evidence.timestamp
                    },
              ...(source === 'present' ? { resumeCommand } : {})
            })
          ),
          page: result.page,
          generation: result.generation,
          truncated: { ...result.truncated, freshness: false },
          durationMs: result.durationMs,
          ...(request.debug
            ? {
                debug: {
                  route: result.planner.route,
                  ...(result.planner.repairedTerms
                    ? { repairedTerms: result.planner.repairedTerms }
                    : {}),
                  plannerReport: {
                    route: result.planner.route,
                    scope: result.planner.tier,
                    ...(result.planner.repairedTerms
                      ? { repairedTerms: result.planner.repairedTerms }
                      : {})
                  }
                }
              }
            : {})
        }
      } catch (error) {
        if (!(error instanceof SessionSearchCursorError)) {
          throw error
        }
        return error.rejection === 'stale-generation'
          ? {
              kind: 'stale-cursor',
              generation: error.actualGeneration,
              ...(error.expectedGeneration === undefined
                ? {}
                : { expectedGeneration: error.expectedGeneration })
            }
          : { kind: 'malformed-cursor' }
      }
    }
  }
}
