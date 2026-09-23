import { requestQuickOpenFileListing } from '@/components/quick-open-file-listing-request'
import { getNestedWorktreeExcludePaths } from '@/components/quick-open-file-list'
import {
  getTerminalFileContext,
  openDetectedFilePath,
  type FileOpenFailure
} from '@/components/terminal-pane/terminal-file-open-routing'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { basename, joinPath } from '@/lib/path'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { cancelRuntimeFileList } from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import type { NativeChatFileLinkContext } from './native-chat-file-link'
import {
  showFileLinkNotFoundToast,
  showFileLinkUnverifiableToast
} from './native-chat-file-link-toasts'

export function findFileLinkSearchMatches(files: readonly string[], searchPath: string): string[] {
  return files.filter((file) => {
    const normalized = file.replace(/\\/g, '/')
    return normalized === searchPath || normalized.endsWith(`/${searchPath}`)
  })
}

async function listWorkspaceFiles(
  context: NativeChatFileLinkContext,
  searchPath: string,
  signal: AbortSignal
): Promise<string[]> {
  const state = useAppStore.getState()
  const repoId = state.getKnownWorktreeById(context.worktreeId)?.repoId
  const excludePaths = getNestedWorktreeExcludePaths(
    context.worktreeId,
    context.worktreePath,
    (repoId ? state.worktreesByRepo[repoId] : undefined) ?? []
  )
  const requestContext = {
    ...getTerminalFileContext(
      context.worktreeId,
      context.worktreePath,
      context.runtimeEnvironmentId
    ),
    worktreePath: context.worktreePath
  }
  const requestToken = createBrowserUuid()
  // Why: a superseded click must stop the host-side scan too, not only drop its result.
  const cancel = (): void => cancelRuntimeFileList(requestContext, requestToken)
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const listing = await requestQuickOpenFileListing(requestContext, {
      query: basename(searchPath),
      // Why: a large local workspace caps its listing; filtering by name keeps the match in it.
      nameFilter: basename(searchPath),
      requestToken,
      signal,
      ...(excludePaths.length > 0 ? { excludePaths } : {})
    })
    return listing.files
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

function reportMatchedFileFailure(absolutePath: string, failure: FileOpenFailure): void {
  // Why: the listing can be stale; never fall back into another search.
  if (failure.verdict === 'missing') {
    showFileLinkNotFoundToast(absolutePath)
    return
  }
  showFileLinkUnverifiableToast(absolutePath, failure.error)
}

/**
 * Agents often name a file by basename or by a path relative to their own cwd. A unique
 * workspace match opens directly; anything else lands in Quick Open, so the click is never dead.
 */
export async function openFileLinkBySearch(args: {
  searchPath: string
  line: number | null
  column: number | null
  context: NativeChatFileLinkContext
  openWithSystemDefault: boolean
  /** Aborts once a later click supersedes this one. */
  signal: AbortSignal
}): Promise<void> {
  const { context, searchPath, signal } = args
  let matches: string[] = []
  try {
    matches = findFileLinkSearchMatches(
      await listWorkspaceFiles(context, searchPath, signal),
      searchPath
    )
  } catch {
    // Quick Open below reports its own listing error.
  }
  if (signal.aborted) {
    return
  }
  if (matches.length === 1) {
    const absolutePath = joinPath(context.worktreePath, matches[0])
    openDetectedFilePath(absolutePath, args.line, args.column, {
      worktreeId: context.worktreeId,
      worktreePath: context.worktreePath,
      runtimeEnvironmentId: context.runtimeEnvironmentId,
      openWithSystemDefault: args.openWithSystemDefault,
      onOpenFailure: (failure) => reportMatchedFileFailure(absolutePath, failure)
    })
    return
  }
  const state = useAppStore.getState()
  if (state.activeWorktreeId !== context.worktreeId) {
    // Why: Quick Open lists the active workspace.
    activateAndRevealWorkspace(context.worktreeId)
  }
  useAppStore.getState().openModal('quick-open', { initialQuery: searchPath })
}
