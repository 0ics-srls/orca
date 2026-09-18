import type { ExecutionHostId } from '../../shared/execution-host'
import type { Project, ProjectHostSetup } from '../../shared/project-types'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'

/**
 * What one execution host knows about its own repos, projects and workspaces —
 * the only inputs a scope identity is resolved against.
 *
 * Deliberately a snapshot of persisted state and never a git scan: the prefixes
 * a project resolves to are its checkout, the directory Orca creates its
 * worktrees in and the registered worktrees outside it, none of which requires
 * enumerating hundreds of working trees to answer one search.
 */
export type SessionSearchScopeCatalog = {
  repos: readonly Pick<
    Repo,
    'id' | 'path' | 'kind' | 'worktreeBasePath' | 'connectionId' | 'executionHostId'
  >[]
  projects: readonly Pick<Project, 'id' | 'sourceRepoIds'>[]
  projectHostSetups: readonly Pick<
    ProjectHostSetup,
    'projectId' | 'repoId' | 'path' | 'worktreeBasePath'
  >[]
  /** Registered workspaces of this host, keyed by worktree id. */
  worktreeMeta: Readonly<Record<string, Pick<WorktreeMeta, 'projectId' | 'priorWorktreeIds'>>>
  settings: { workspaceDir: string; nestWorkspaces: boolean }
}

export type SessionSearchScopeCatalogSource = (
  executionHostId: ExecutionHostId
) => SessionSearchScopeCatalog | null

// Why a source and not a value: the desktop composition root owns the store, and
// this module is imported by the relay too — where no such store exists and every
// read must stay null so a scope is refused rather than silently widened.
let readCatalog: SessionSearchScopeCatalogSource | null = null

export function installSessionSearchScopeCatalogSource(
  source: SessionSearchScopeCatalogSource | null
): void {
  readCatalog = source
}

export function sessionSearchScopeCatalog(
  executionHostId: ExecutionHostId
): SessionSearchScopeCatalog | null {
  return readCatalog?.(executionHostId) ?? null
}

export function resetSessionSearchScopeCatalogForTests(): void {
  readCatalog = null
}
