import { z } from 'zod'

/**
 * Which scope a search covers, named by identity rather than by path.
 *
 * Why not a path list: the panel used to translate "this project" into one path
 * per worktree, which a repo with hundreds of worktrees blows past. The identity
 * travels instead, and every execution host resolves it against its own catalog
 * — so the same request means "this project here" on each host it reaches.
 *
 * `within` is the field name on the request because `scope` there already means
 * the search tier (`conversation` / `all`).
 */
export const AiVaultSearchScopeIdentitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace'), worktreeId: z.string().min(1).max(8192) }),
  z.object({ kind: z.literal('project'), projectKey: z.string().min(1).max(1024) })
])

/**
 * The host's acknowledgement that it understood `within` and narrowed to it.
 *
 * Presence is the whole signal, so it carries nothing: host paths are withheld
 * over the relay, and no reader has a use for a count. A `results` answer to a
 * `within` request without this field came from a host that predates the field
 * and silently searched everything.
 */
export const AiVaultSearchResolvedWithinSchema = z.literal(true)

export type AiVaultSearchScopeIdentity = z.infer<typeof AiVaultSearchScopeIdentitySchema>
