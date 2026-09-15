import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type { BaseRefDefaultResult, BaseRefSearchResult, Repo } from '../../../shared/repo-types'
import {
  clampRepoSearchRefsLimit,
  REPO_SEARCH_REFS_DEFAULT_LIMIT,
  isRepoSearchRefsRequestLimit
} from '../../../shared/repo-search-limits'
import { isFolderRepo } from '../../../shared/repo-kind'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import {
  getBaseRefDefault,
  getRemoteCount,
  parseRemoteCount,
  resolveDefaultBaseRefViaExec
} from '../../git/repo'
import {
  searchBaseRefDetailsOnSsh,
  searchBaseRefDetailsOutcome
} from '../../git/repo-base-ref-search'
import { getSshGitProvider } from '../../providers/ssh-git-dispatch'

export function registerBaseRefQueryHandlers(store: Store): void {
  ipcMain.handle(
    'repos:getBaseRefDefault',
    async (
      _event,
      args: { repoId: string; hostId?: ExecutionHostId }
    ): Promise<BaseRefDefaultResult> => {
      const repo = getRepoForExecutionHost(store, args.repoId, args.hostId)
      if (!repo || isFolderRepo(repo)) {
        // Why: folder repos have no git state for a base ref; return null + 0 so the renderer skips a fabricated default.
        return { defaultBaseRef: null, remoteCount: 0 }
      }
      // Why: remote repos need the relay to resolve symbolic-ref where the git data lives.
      if (repo.connectionId) {
        const provider = getSshGitProvider(repo.connectionId)
        if (!provider) {
          return { defaultBaseRef: null, remoteCount: 0 }
        }
        // Why: delegate to shared resolveDefaultBaseRefViaExec; log symbolic-ref failures here to keep the SSH transport diagnostic it otherwise swallows.
        const resolveDefault = async (): Promise<string | null> => {
          return resolveDefaultBaseRefViaExec(async (argv) => {
            try {
              return await provider.exec(argv, repo.path)
            } catch (err) {
              if (argv[0] === 'symbolic-ref') {
                console.warn('[repos:getBaseRefDefault] SSH symbolic-ref failed', {
                  path: repo.path,
                  err
                })
              }
              throw err
            }
          })
        }

        const resolveRemoteCount = async (): Promise<number> => {
          try {
            const remotesResult = await provider.exec(['remote'], repo.path)
            return parseRemoteCount(remotesResult.stdout)
          } catch (err) {
            // Why: 0 = unknown sentinel that suppresses the multi-remote hint.
            console.warn('[repos:getBaseRefDefault] SSH git remote count failed', {
              path: repo.path,
              err
            })
            return 0
          }
        }

        const [defaultBaseRef, remoteCount] = await Promise.all([
          resolveDefault(),
          resolveRemoteCount()
        ])
        return { defaultBaseRef, remoteCount }
      }
      // Why: run in parallel; a remote-count failure must not break default detection.
      const [defaultBaseRef, remoteCount] = await Promise.all([
        getBaseRefDefault(repo.path),
        getRemoteCount(repo.path)
      ])
      return { defaultBaseRef, remoteCount }
    }
  )

  ipcMain.handle(
    'repos:searchBaseRefs',
    async (
      _event,
      args: { repoId: string; query: string; limit?: number; hostId?: ExecutionHostId }
    ) => {
      return (await searchBaseRefDetailsForRepo(store, args)).map((entry) => entry.refName)
    }
  )

  ipcMain.handle(
    'repos:searchBaseRefDetails',
    async (
      _event,
      args: { repoId: string; query: string; limit?: number; hostId?: ExecutionHostId }
    ) => {
      return searchBaseRefDetailsForRepo(store, args)
    }
  )
}

async function searchBaseRefDetailsForRepo(
  store: Store,
  args: { repoId: string; query: string; limit?: number; hostId?: ExecutionHostId }
): Promise<BaseRefSearchResult[]> {
  const repo = getRepoForExecutionHost(store, args.repoId, args.hostId)
  if (!repo || isFolderRepo(repo)) {
    return []
  }
  const requestedLimit = args.limit ?? REPO_SEARCH_REFS_DEFAULT_LIMIT
  if (!isRepoSearchRefsRequestLimit(requestedLimit)) {
    return []
  }
  // Keep the public IPC shape forgiving while bounding Git and retained results
  // for callers that request an unusually large page.
  const limit = clampRepoSearchRefsLimit(requestedLimit)
  const outcome = repo.connectionId
    ? await searchBaseRefDetailsOnSsh(
        repo.path,
        args.query,
        limit,
        getSshGitProvider(repo.connectionId)
      )
    : await searchBaseRefDetailsOutcome(repo.path, args.query, limit)
  if (outcome.status === 'unverifiable') {
    throw new Error(outcome.reason)
  }
  return outcome.results
}

function getRepoForExecutionHost(
  store: Store,
  repoId: string,
  hostId?: ExecutionHostId
): Repo | null {
  if (!hostId) {
    return store.getRepo(repoId) ?? null
  }
  // Why: repo ids can collide across local and SSH hosts; read must use the same host the Settings pane selected for the write.
  return (
    store
      .getRepos()
      .find((repo) => repo.id === repoId && getRepoExecutionHostId(repo) === hostId) ?? null
  )
}
