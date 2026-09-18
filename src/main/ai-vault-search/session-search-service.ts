import type {
  AiVaultSearchRequest,
  AiVaultSearchResponse,
  AiVaultSearchStatus
} from '../../shared/ai-vault-search-types'
import type { SessionSearchEngine } from './session-search-engine'
import type { SessionSearchIndexer } from './session-search-indexer'
import { SessionSearchCursorError } from './session-search-page-cursor'

/**
 * What the answering host made of a scope identity. Absent means the request
 * carried none and still searches everything.
 *
 * Why the paths ride here and not in `filters.scopePaths`: that is a wire field,
 * capped at 64 entries for the clients that fill it in by hand. A project whose
 * worktrees do not share one managed directory resolves to one path per
 * worktree, and 100 of them would be refused by the very schema the request is
 * re-parsed with inside the scanner child. These paths never cross a wire — the
 * host that resolved them is the host that searches — so no cap applies.
 *
 * Why `unknown` travels here rather than being answered by the caller: a host
 * that is switched off or still starting owes the reader that answer, for a
 * scoped request exactly as for an unscoped one. Those answers are made below,
 * after consent and readiness are checked, so the verdict has to arrive where
 * they are made and not before.
 */
export type SessionSearchHostScope =
  | { kind: 'resolved'; paths: readonly string[] }
  | { kind: 'unknown' }

export type SessionSearchService = {
  search(
    req: AiVaultSearchRequest,
    hostScope?: SessionSearchHostScope
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
    search: async (request, hostScope) => {
      // Reached only through a live index, so consent and readiness are already
      // answered: an unresolvable scope is this host's last word, not a fallback.
      if (hostScope?.kind === 'unknown') {
        return { kind: 'unavailable', reason: 'scope-unknown' }
      }
      if (request.cursor === '') {
        return { kind: 'malformed-cursor' }
      }
      try {
        const result = engine.search(
          hostScope
            ? { ...request, filters: { ...request.filters, scopePaths: hostScope.paths } }
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
