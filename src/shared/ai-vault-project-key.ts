/**
 * One spelling of "which project" for the sessions panel and for a host
 * resolving a search scope, so a key minted on a client and a key matched on the
 * execution host cannot drift apart.
 */
export function toAiVaultProjectKey(
  projectId: string | null | undefined,
  repoId?: string | null
): string | null {
  if (projectId) {
    // Why: legacy projections can already use repo-prefixed project ids; wrapping
    // them again would split active scope and resolved session keys.
    return projectId.startsWith('repo:') ? projectId : `project:${projectId}`
  }
  return repoId ? `repo:${repoId}` : null
}
