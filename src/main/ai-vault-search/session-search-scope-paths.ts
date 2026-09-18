import {
  getRuntimePathBasename,
  isPathInsideOrEqual,
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison,
  resolveRuntimePath
} from '../../shared/cross-platform-path'
import { isFolderRepo } from '../../shared/repo-kind'
import { resolveConfiguredWorktreeBasePaths } from '../../shared/worktree/configured-worktree-base-path'
import { buildKnownOrcaWorkspaceLayouts } from '../../shared/worktree/ownership'
import type { SessionSearchScopeCatalog } from './session-search-scope-catalog'

type ScopeRepo = SessionSearchScopeCatalog['repos'][number]

/** Absolute paths in insertion order, deduplicated by the comparison key. */
export class ScopePathSet {
  private readonly seen = new Set<string>()
  private readonly entries: string[] = []

  add(value: string | null | undefined): void {
    const trimmed = value?.trim()
    if (!trimmed || !isRuntimePathAbsolute(trimmed)) {
      return
    }
    const key = normalizeRuntimePathForComparison(trimmed)
    if (this.seen.has(key)) {
      return
    }
    this.seen.add(key)
    this.entries.push(trimmed)
  }

  /**
   * The paths with every entry that sits inside another removed.
   *
   * Why fold at all: the index matches by prefix, so a managed worktree
   * directory already covers the hundreds of worktrees under it. Keeping them
   * would put one SQL range per worktree into a single query for no extra rows.
   */
  folded(): string[] {
    return this.entries.filter(
      (candidate) =>
        !this.entries.some((other) => other !== candidate && isPathInsideOrEqual(other, candidate))
    )
  }
}

/**
 * The directories Orca creates this repo's worktrees in, past and present, where
 * such a directory belongs to this repo alone.
 *
 * `buildKnownOrcaWorkspaceLayouts` is the same enumeration worktree ownership
 * uses, so a workspace root the user has since moved away from — its history is
 * persisted for exactly this reason — is covered here too, and a desktop-local
 * absolute root is already excluded for a remote repo.
 *
 * Which of those layouts can be claimed: a repo-level base path is an explicit
 * statement that the directory holds this project's workspaces, so it always
 * counts. A global root counts only where nesting puts this repo's worktrees in
 * their own subdirectory; flat placement makes that root every project's, and
 * claiming it would widen a project search to the whole machine.
 *
 * Nothing is lost when this is empty. Every worktree Orca registered is still
 * listed individually; only the folding is.
 */
export function managedWorktreeDirectories(
  repo: ScopeRepo,
  settings: SessionSearchScopeCatalog['settings']
): string[] {
  if (isFolderRepo(repo)) {
    return []
  }
  const configured = new Set(
    resolveConfiguredWorktreeBasePaths(repo).map(normalizeRuntimePathForComparison)
  )
  const repoName = getRuntimePathBasename(repo.path).replace(/\.git$/, '')
  const directories: string[] = []
  for (const layout of buildKnownOrcaWorkspaceLayouts(settings, repo)) {
    if (configured.has(normalizeRuntimePathForComparison(layout.path))) {
      directories.push(layout.path)
    } else if (layout.nestWorkspaces && repoName) {
      directories.push(resolveRuntimePath(layout.path, repoName))
    }
  }
  return directories
}
