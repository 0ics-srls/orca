import type { AiVaultSearchRequest, AiVaultSearchResponse } from './ai-vault-search-types'

/**
 * Whether a host answered a scoped search without acknowledging the scope.
 *
 * Zod strips unknown fields, so a host built before `within` existed accepts the
 * request, ignores the field, and answers with every session it has. Nothing in
 * the hits says so. The absence of `resolvedWithin` on a `results` answer is the
 * only evidence there is, and it means this computer needs an update — never
 * that the scope matched everything.
 */
export function isUnacknowledgedScopedSearch(
  request: Pick<AiVaultSearchRequest, 'within'> | null | undefined,
  response: AiVaultSearchResponse | null | undefined
): boolean {
  return (
    request?.within !== undefined &&
    response?.kind === 'results' &&
    response.resolvedWithin === undefined
  )
}
