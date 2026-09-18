import { toAiVaultProjectKey } from '../../shared/ai-vault-project-key'
import type { AiVaultSearchScopeIdentity } from '../../shared/ai-vault-search-scope'
import {
  getRepoIdFromWorktreeId,
  getRepoMainWorktreeId,
  splitWorktreeIdForFilesystem,
  worktreeIdsEqual
} from '../../shared/worktree/id'
import { areRuntimePathsEqual } from '../../shared/worktree/ownership'
import type { SessionSearchScopeCatalog } from './session-search-scope-catalog'
import { managedWorktreeDirectories, ScopePathSet } from './session-search-scope-paths'

export type SessionSearchScopeResolution =
  | { kind: 'resolved'; paths: string[] }
  /** This host has no such workspace or project. Never a reason to search everything. */
  | { kind: 'unknown' }

type ScopeRepo = SessionSearchScopeCatalog['repos'][number]

export function resolveSessionSearchScope(
  within: AiVaultSearchScopeIdentity,
  catalog: SessionSearchScopeCatalog | null
): SessionSearchScopeResolution {
  if (!catalog) {
    return { kind: 'unknown' }
  }
  const paths =
    within.kind === 'workspace'
      ? resolveWorkspaceScope(within.worktreeId, catalog)
      : resolveProjectScope(within.projectKey, catalog)
  return paths.length > 0 ? { kind: 'resolved', paths } : { kind: 'unknown' }
}

/**
 * One workspace: its directory today, plus the directories it occupied before it
 * was renamed on disk. Transcripts are keyed by working directory only, so a
 * renamed workspace's own history lives under its old paths.
 */
function resolveWorkspaceScope(worktreeId: string, catalog: SessionSearchScopeCatalog): string[] {
  const repo = repoById(catalog, getRepoIdFromWorktreeId(worktreeId))
  if (!repo) {
    return []
  }
  const registeredId = registeredWorktreeId(worktreeId, repo, catalog)
  if (registeredId === null) {
    return []
  }
  const paths = new ScopePathSet()
  paths.add(splitWorktreeIdForFilesystem(registeredId)?.worktreePath)
  addPriorWorktreePaths(paths, registeredId, catalog)
  return paths.folded()
}

/**
 * Which worktree id this host has on file for the one the client named, or null.
 *
 * Why go through the registry rather than reading the path out of the id: the id
 * is client-supplied and embeds a directory, and a scope identity must not be a
 * way to hand the host a path to search. Matching a key the host itself wrote —
 * or the repo's own checkout, which needs no row — keeps the directory the
 * host's. The spelling returned is the host's, not the caller's.
 */
function registeredWorktreeId(
  worktreeId: string,
  repo: ScopeRepo,
  catalog: SessionSearchScopeCatalog
): string | null {
  if (catalog.worktreeMeta[worktreeId]) {
    return worktreeId
  }
  const registered = Object.keys(catalog.worktreeMeta).find((key) =>
    worktreeIdsEqual(key, worktreeId)
  )
  if (registered) {
    return registered
  }
  // The repo's own checkout, and a folder project's workspaces, all sit at the
  // repo path — which this host recorded when it registered the repo, so no
  // worktree row has to vouch for it.
  const named = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
  return named && areRuntimePathsEqual(named, repo.path) ? getRepoMainWorktreeId(repo) : null
}

/**
 * One project on this host: every repo the key names, each contributing its
 * checkout, the directories Orca creates its worktrees in, and every registered
 * worktree that lives outside them. A project set up on several hosts resolves on
 * each of them, because the key is the project's id and not a path.
 */
function resolveProjectScope(projectKey: string, catalog: SessionSearchScopeCatalog): string[] {
  const paths = new ScopePathSet()
  const repoIds = new Set<string>()
  for (const setup of catalog.projectHostSetups) {
    if (toAiVaultProjectKey(setup.projectId, setup.repoId) === projectKey) {
      repoIds.add(setup.repoId)
      paths.add(setup.path)
      paths.add(setup.worktreeBasePath)
    }
  }
  const projectId = projectKey.startsWith('project:') ? projectKey.slice('project:'.length) : null
  for (const project of catalog.projects) {
    if (project.id === projectId) {
      for (const repoId of project.sourceRepoIds) {
        repoIds.add(repoId)
      }
    }
  }
  // A repo-keyed project is the repo itself, which no setup row has to mention.
  if (projectKey.startsWith('repo:')) {
    repoIds.add(projectKey.slice('repo:'.length))
  }
  for (const [worktreeId, meta] of Object.entries(catalog.worktreeMeta)) {
    const repoId = getRepoIdFromWorktreeId(worktreeId)
    if (toAiVaultProjectKey(meta.projectId ?? null, repoId) === projectKey) {
      repoIds.add(repoId)
    }
  }
  for (const repoId of repoIds) {
    const repo = repoById(catalog, repoId)
    if (repo) {
      addRepoScopePaths(paths, repo, catalog)
    }
  }
  return paths.folded()
}

function addRepoScopePaths(
  paths: ScopePathSet,
  repo: ScopeRepo,
  catalog: SessionSearchScopeCatalog
): void {
  paths.add(repo.path)
  for (const directory of managedWorktreeDirectories(repo, catalog.settings)) {
    paths.add(directory)
  }
  for (const worktreeId of Object.keys(catalog.worktreeMeta)) {
    if (getRepoIdFromWorktreeId(worktreeId) !== repo.id) {
      continue
    }
    paths.add(splitWorktreeIdForFilesystem(worktreeId)?.worktreePath)
    addPriorWorktreePaths(paths, worktreeId, catalog)
  }
}

/**
 * A prior path that another registered workspace now occupies belongs to that
 * workspace, not to this one: the worktree id embeds the path, so the claimant's
 * id *is* the prior id. Skipping it keeps a renamed workspace from pulling a
 * sibling's transcripts into a Workspace-scoped search.
 */
function addPriorWorktreePaths(
  paths: ScopePathSet,
  worktreeId: string,
  catalog: SessionSearchScopeCatalog
): void {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  for (const priorWorktreeId of catalog.worktreeMeta[worktreeId]?.priorWorktreeIds ?? []) {
    if (priorWorktreeId === worktreeId || catalog.worktreeMeta[priorWorktreeId]) {
      continue
    }
    const parsed = splitWorktreeIdForFilesystem(priorWorktreeId)
    if (parsed?.repoId === repoId) {
      paths.add(parsed.worktreePath)
    }
  }
}

function repoById(catalog: SessionSearchScopeCatalog, repoId: string): ScopeRepo | undefined {
  return catalog.repos.find((repo) => repo.id === repoId)
}
