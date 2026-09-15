import type { BaseRefSearchResult } from '../../shared/repo-types'
import { isForEachRefExcludeUnsupportedError } from '../../shared/git-ref-command-capabilities'
import {
  clampRepoSearchRefsLimit,
  clampRepoSearchRefsScanLimit,
  REPO_SEARCH_REFS_DEFAULT_LIMIT,
  isRepoSearchRefsRequestLimit,
  isRepoSearchRefsScanLimit
} from '../../shared/repo-search-limits'
import { isSafeGitRefName } from '../../shared/git-status-upstream-ref'
import type { GitCapabilityCache } from '../../shared/git-capability-cache'
import {
  parseAndFilterSearchRefDetails,
  resolveConfiguredRemoteBranchName,
  resolveLocalBranchName
} from './base-ref-search-result-parsing'
import { getLocalGitCapabilityCache, getSshGitCapabilityCache } from './git-capability-state'
import { gitExecFileAsync } from './runner'
import type { SshGitProvider } from '../providers/ssh-git-provider'

const REF_SEARCH_CANDIDATE_MULTIPLIER = 4
const REF_SEARCH_LEGACY_HEADROOM = 100

type RefSearchPatternGroup = 'all' | 'segmented' | 'branchRoot'

function getRefSearchTokens(normalizedQuery: string): string[] {
  return normalizedQuery.split('/').filter((token) => token.length > 0)
}

function getRefSearchCandidateCount(limit: number, excludesRemoteHead: boolean): number {
  if (!isRepoSearchRefsScanLimit(limit)) {
    throw new Error('invalid_limit')
  }
  const baseCount = limit * REF_SEARCH_CANDIDATE_MULTIPLIER
  return excludesRemoteHead ? baseCount : baseCount + REF_SEARCH_LEGACY_HEADROOM
}

/** Build excludes for the symbolic `<remote>/HEAD` slot without hiding
 * nested branch names such as `<remote>/feature/HEAD`. */
function getRemoteHeadExcludes(remoteNames: readonly string[] | undefined): string[] {
  if (remoteNames && remoteNames.length > 0) {
    // A single-component wildcard covers the overwhelmingly common remote
    // shape. Keep exact excludes only for slash-containing remote names, where
    // that wildcard cannot reach the direct `<remote>/HEAD` slot without also
    // hiding legal nested branches such as `<remote>/feature/HEAD`.
    const slashRemotes = [...new Set(remoteNames)].filter(
      (remote) => remote.includes('/') && isSafeGitRefName(`refs/remotes/${remote}/HEAD`)
    )
    return [
      '--exclude=refs/remotes/*/HEAD',
      ...slashRemotes.map((remote) => `--exclude=refs/remotes/${remote}/HEAD`)
    ]
  }
  // `*` does not cross `/`, unlike `**`; this keeps unknown nested remotes
  // eligible for the parser's branch-name matching.
  return ['--exclude=refs/remotes/*/HEAD']
}

/** Build the bounded `for-each-ref` argv shared by local and remote searches. */
export function buildSearchBaseRefsArgv(
  normalizedQuery: string,
  limit: number,
  options: {
    excludeRemoteHead?: boolean
    remoteNames?: readonly string[]
    patternGroup?: RefSearchPatternGroup
  } = {}
): string[] {
  const excludeRemoteHead = options.excludeRemoteHead ?? true
  // A caller may ask for more rows than the retained-result cap. Keep that
  // request useful while bounding the Git command to the safe probe window.
  const boundedScanLimit = clampRepoSearchRefsScanLimit(limit)
  const candidateCount = getRefSearchCandidateCount(boundedScanLimit, excludeRemoteHead)
  const base = [
    'for-each-ref',
    '--format=%(refname)%00%(refname:short)',
    '--sort=-committerdate',
    ...(excludeRemoteHead ? getRemoteHeadExcludes(options.remoteNames) : []),
    `--count=${candidateCount}`
  ]
  const tokens = getRefSearchTokens(normalizedQuery)
  if (tokens.length <= 1) {
    const query = tokens[0] ?? ''
    return [
      ...base,
      `refs/heads/**/*${query}*`,
      `refs/heads/**/*${query}*/**`,
      `refs/remotes/**/*${query}*`,
      `refs/remotes/**/*${query}*/**`
    ]
  }

  const segmented = tokens.map((token) => `*${token}*`).join('/')
  const substringQuery = tokens.join('/')
  const remoteBranchRootPatterns =
    options.remoteNames && options.remoteNames.length > 0
      ? options.remoteNames.flatMap((remote) => [
          `refs/remotes/${remote}/${substringQuery}*`,
          `refs/remotes/${remote}/${substringQuery}*/**`
        ])
      : [`refs/remotes/*/${substringQuery}*`, `refs/remotes/*/${substringQuery}*/**`]
  const segmentedPatterns = [`refs/remotes/${segmented}`, `refs/heads/${segmented}`]
  const branchRootPatterns = [
    `refs/heads/${substringQuery}*`,
    `refs/heads/${substringQuery}*/**`,
    ...remoteBranchRootPatterns
  ]
  const patterns =
    options.patternGroup === 'segmented'
      ? segmentedPatterns
      : options.patternGroup === 'branchRoot'
        ? branchRootPatterns
        : [...segmentedPatterns, ...branchRootPatterns]
  return [...base, ...patterns]
}

async function runSearchBaseRefsGit(
  normalizedQuery: string,
  limit: number,
  options: { remoteNames: readonly string[]; patternGroup?: RefSearchPatternGroup },
  execGit: (args: string[]) => Promise<{ stdout: string }>,
  capabilities: GitCapabilityCache
): Promise<{ stdout: string }> {
  return capabilities.runWithFallback(
    'for-each-ref-exclude',
    () => execGit(buildSearchBaseRefsArgv(normalizedQuery, limit, options)),
    () =>
      execGit(
        buildSearchBaseRefsArgv(normalizedQuery, limit, { ...options, excludeRemoteHead: false })
      ),
    isForEachRefExcludeUnsupportedError
  )
}

export function mergeBaseRefSearchResultGroups(
  groups: readonly BaseRefSearchResult[][],
  limit: number
): BaseRefSearchResult[] {
  const seen = new Set<string>()
  const merged: BaseRefSearchResult[] = []
  const maxLength = Math.max(0, ...groups.map((group) => group.length))
  for (let index = 0; index < maxLength && merged.length < limit; index += 1) {
    for (const group of groups) {
      const entry = group[index]
      if (!entry || seen.has(entry.refName)) {
        continue
      }
      seen.add(entry.refName)
      merged.push(entry)
      if (merged.length >= limit) {
        break
      }
    }
  }
  return merged
}

export type BaseRefSearchOutcome =
  | { status: 'ok'; results: BaseRefSearchResult[] }
  | { status: 'unverifiable'; reason: string }

export async function searchBaseRefs(
  path: string,
  query: string,
  limit = REPO_SEARCH_REFS_DEFAULT_LIMIT
): Promise<string[]> {
  if (!isRepoSearchRefsRequestLimit(limit)) {
    return []
  }
  const boundedLimit = clampRepoSearchRefsLimit(limit)
  return (await searchBaseRefDetails(path, query, boundedLimit)).map((entry) => entry.refName)
}

export async function searchBaseRefDetails(
  path: string,
  query: string,
  limit = REPO_SEARCH_REFS_DEFAULT_LIMIT
): Promise<BaseRefSearchResult[]> {
  const outcome = await searchBaseRefDetailsOutcome(path, query, limit)
  return outcome.status === 'ok' ? outcome.results : []
}

export async function searchBaseRefDetailsOutcome(
  path: string,
  query: string,
  limit = REPO_SEARCH_REFS_DEFAULT_LIMIT
): Promise<BaseRefSearchOutcome> {
  return searchBaseRefDetailsWithGit(
    path,
    query,
    limit,
    (args) => gitExecFileAsync(args, { cwd: path }),
    getLocalGitCapabilityCache({ cwd: path })
  )
}

export async function searchBaseRefDetailsOnSsh(
  path: string,
  query: string,
  limit: number,
  provider: SshGitProvider | undefined
): Promise<BaseRefSearchOutcome> {
  if (!provider) {
    return { status: 'unverifiable', reason: 'no SSH git provider for this connection' }
  }
  return searchBaseRefDetailsWithGit(
    path,
    query,
    limit,
    (args) => provider.exec(args, path),
    getSshGitCapabilityCache(provider)
  )
}

async function searchBaseRefDetailsWithGit(
  path: string,
  query: string,
  limit: number,
  execGit: (args: string[]) => Promise<{ stdout: string }>,
  capabilities: GitCapabilityCache
): Promise<BaseRefSearchOutcome> {
  if (!isRepoSearchRefsRequestLimit(limit)) {
    return { status: 'unverifiable', reason: `invalid ref search limit: ${String(limit)}` }
  }
  const boundedScanLimit = clampRepoSearchRefsScanLimit(limit)
  const normalizedQuery = normalizeRefSearchQuery(query)

  try {
    // Remote names determine multi-segment search patterns; a failed lookup is not an empty list.
    let remotes: string[]
    try {
      remotes = (await execGit(['remote'])).stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    } catch (error) {
      return { status: 'unverifiable', reason: describeBaseRefSearchFailure(error, 'remote') }
    }
    const tokens = getRefSearchTokens(normalizedQuery)
    if (tokens.length > 1) {
      const results = await Promise.all([
        runSearchBaseRefsGit(
          normalizedQuery,
          boundedScanLimit,
          {
            remoteNames: remotes,
            patternGroup: 'segmented'
          },
          execGit,
          capabilities
        ),
        runSearchBaseRefsGit(
          normalizedQuery,
          boundedScanLimit,
          {
            remoteNames: remotes,
            patternGroup: 'branchRoot'
          },
          execGit,
          capabilities
        )
      ])
      return {
        status: 'ok',
        results: mergeBaseRefSearchResultGroups(
          results.map((entry) =>
            parseAndFilterSearchRefDetails(entry.stdout, boundedScanLimit, remotes)
          ),
          boundedScanLimit
        )
      }
    }

    const result = await runSearchBaseRefsGit(
      normalizedQuery,
      boundedScanLimit,
      {
        remoteNames: remotes
      },
      execGit,
      capabilities
    )
    return {
      status: 'ok',
      results: parseAndFilterSearchRefDetails(result.stdout, boundedScanLimit, remotes)
    }
  } catch (err) {
    console.warn('[searchBaseRefs] git ref search failed', { path, err })
    return { status: 'unverifiable', reason: describeBaseRefSearchFailure(err, 'for-each-ref') }
  }
}

function describeBaseRefSearchFailure(error: unknown, command: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const firstLine = message.split('\n')[0]?.trim()
  return firstLine ? `git ${command} failed: ${firstLine}` : `git ${command} failed`
}

export function normalizeRefSearchQuery(query: string): string {
  return query.trim().replace(/[*?[\]\\]/g, '')
}

export { parseAndFilterSearchRefDetails, resolveConfiguredRemoteBranchName, resolveLocalBranchName }
