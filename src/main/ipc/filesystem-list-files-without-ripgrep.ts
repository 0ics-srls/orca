import { isQuickOpenReaddirBudgetError } from '../../shared/quick-open-readdir-walk'
import { listFilesWithGit } from './filesystem-list-files-git-fallback'

/** Lists through git/readdir; a `pathFilter` scans every file because these cap scanned files, not matches. */
export async function listFilesWithoutRipgrep(
  rootPath: string,
  excludePathPrefixes: readonly string[],
  localGitOptions: { wslDistro?: string },
  signal: AbortSignal | undefined,
  maxResults: number | undefined,
  pathFilter: ((relativePath: string) => boolean) | undefined
): Promise<string[]> {
  if (!pathFilter) {
    return listFilesWithGit(rootPath, excludePathPrefixes, localGitOptions, signal, maxResults)
  }
  let files: string[]
  try {
    files = await listFilesWithGit(rootPath, excludePathPrefixes, localGitOptions, signal)
  } catch (err) {
    if (!isQuickOpenReaddirBudgetError(err)) {
      throw err
    }
    // Why: a huge non-git folder exceeds the uncapped walk budget; keep the capped prefix.
    files = await listFilesWithGit(
      rootPath,
      excludePathPrefixes,
      localGitOptions,
      signal,
      maxResults
    )
  }
  return files.filter(pathFilter).slice(0, maxResults)
}
