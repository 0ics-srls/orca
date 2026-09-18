import { toAiVaultProjectKey } from '../../shared/ai-vault-project-key'
import type { AiVaultSearchScopeIdentity } from '../../shared/ai-vault-search-scope'
import { getRepoIdFromWorktreeId, splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import type { SessionSearchScopeCatalog } from './session-search-scope-catalog'
import { managedWorktreeDirectory, ScopePathSet } from './session-search-scope-paths'

export type SessionSearchScopeResolution =
  | { kind: 'resolved'; identity: AiVaultSearchScopeIdentity['kind']; paths: string[] }
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
  return paths === null ? { kind: 'unknown' } : { kind: 'resolved', identity: within.kind, paths }
}

/**
 * One workspace: its directory today, plus the directories it occupied before it
 * was renamed on disk. Transcripts are keyed by working directory only, so a
 * renamed workspace's own history lives under its old paths.
 */
function resolveWorkspaceScope(
  worktreeId: string,
  catalog: SessionSearchScopeCatalog
): string[] | null {
  const parsed = splitWorktreeIdForFilesystem(worktreeId)
  if (!parsed || !repoById(catalog, parsed.repoId)) {
    return null
  }
  const paths = new ScopePathSet()
  paths.add(parsed.worktreePath)
  addPriorWorktreePaths(paths, worktreeId, catalog)
  const folded = paths.folded()
  return folded.length > 0 ? folded : null
}

/**
 * One project on this host: every repo the key names, each contributing its
 * checkout, the directory Orca creates its worktrees in, and every registered
 * worktree that lives outside that directory. A project set up on several hosts
 * resolves on each of them, because the key is the project's id and not a path.
 */
function resolveProjectScope(
  projectKey: string,
  catalog: SessionSearchScopeCatalog
): string[] | null {
  const paths = new ScopePathSet()
  const repoIds = new Set<string>()
  let matched = false
  for (const setup of catalog.projectHostSetups) {
    if (toAiVaultProjectKey(setup.projectId, setup.repoId) !== projectKey) {
      continue
    }
    matched = true
    repoIds.add(setup.repoId)
    paths.add(setup.path)
    paths.add(setup.worktreeBasePath)
  }
  const projectId = projectKey.startsWith('project:') ? projectKey.slice('project:'.length) : null
  for (const project of catalog.projects) {
    if (project.id === projectId) {
      matched = true
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
      matched = true
      repoIds.add(repoId)
    }
  }
  for (const repoId of repoIds) {
    const repo = repoById(catalog, repoId)
    if (repo) {
      matched = true
      addRepoScopePaths(paths, repo, catalog)
    }
  }
  const folded = paths.folded()
  return matched && folded.length > 0 ? folded : null
}

function addRepoScopePaths(
  paths: ScopePathSet,
  repo: ScopeRepo,
  catalog: SessionSearchScopeCatalog
): void {
  paths.add(repo.path)
  paths.add(managedWorktreeDirectory(repo, catalog.settings))
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
