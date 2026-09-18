import {
  getRuntimePathBasename,
  isPathInsideOrEqual,
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison,
  resolveRuntimePath
} from '../../shared/cross-platform-path'
import { isFolderRepo } from '../../shared/repo-kind'
import {
  isRuntimePathAbsoluteForRepo,
  resolveConfiguredWorktreeBasePaths,
  resolveWorkspaceLayoutPath
} from '../../shared/worktree/configured-worktree-base-path'
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
 * The directory Orca creates this repo's worktrees in, when that directory
 * belongs to this repo alone.
 *
 * A repo-level base path is an explicit statement that the directory holds this
 * project's workspaces, so it always counts. The global workspace root only
 * counts when nesting puts this repo's worktrees in their own subdirectory —
 * flat placement makes it every project's root, and scoping to it would widen a
 * project search to the whole machine. A remote repo under an absolute desktop
 * workspace root has neither: SSH places those worktrees beside the checkout,
 * and the parent of a checkout is not a directory this project owns.
 *
 * Nothing is lost when this is null. Every worktree Orca registered is still
 * listed individually; only the folding is.
 */
export function managedWorktreeDirectory(
  repo: ScopeRepo,
  settings: SessionSearchScopeCatalog['settings']
): string | null {
  const configured = resolveConfiguredWorktreeBasePaths(repo)[0]
  if (configured) {
    return configured
  }
  if (isFolderRepo(repo) || !settings.nestWorkspaces) {
    return null
  }
  if (repo.connectionId && isRuntimePathAbsoluteForRepo(repo.path, settings.workspaceDir)) {
    return null
  }
  const workspaceRoot = resolveWorkspaceLayoutPath(repo.path, settings.workspaceDir)
  const repoName = getRuntimePathBasename(repo.path).replace(/\.git$/, '')
  return repoName ? resolveRuntimePath(workspaceRoot, repoName) : null
}
