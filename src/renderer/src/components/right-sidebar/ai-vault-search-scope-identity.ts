import type { AiVaultSearchScopeIdentity } from '../../../../shared/ai-vault-search-scope'
import type { AiVaultScope } from '../../../../shared/ai-vault-types'

/**
 * The panel's scope as a search request carries it.
 *
 * `all` sends nothing, which still means every session the host has. The other
 * two name what to narrow to and leave the narrowing itself to the host, which
 * is the only side that knows where that workspace or project lives on disk.
 */
export function aiVaultSearchScopeIdentity(args: {
  scope: AiVaultScope
  activeWorktreeId: string | null | undefined
  activeProjectKey: string | null
}): AiVaultSearchScopeIdentity | undefined {
  if (args.scope === 'workspace' && args.activeWorktreeId) {
    return { kind: 'workspace', worktreeId: args.activeWorktreeId }
  }
  if (args.scope === 'project' && args.activeProjectKey) {
    return { kind: 'project', projectKey: args.activeProjectKey }
  }
  return undefined
}
