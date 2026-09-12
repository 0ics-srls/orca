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
import {
  parseAndFilterSearchRefDetails,
  resolveConfiguredRemoteBranchName,
  resolveLocalBranchName
} from './base-ref-search-result-parsing'
import { getLocalGitCapabilityCache } from './git-capability-state'
import { gitExecOptions, type LocalGitExecOptions } from './repo-default-base-ref'
import { gitExecFileAsync } from './runner'

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
  path: string,
  normalizedQuery: string,
  limit: number,
  options: { remoteNames: readonly string[]; patternGroup?: RefSearchPatternGroup }
): Promise<{ stdout: string }> {
  return getLocalGitCapabilityCache({ cwd: path }).runWithFallback(
    'for-each-ref-exclude',
    () =>
      gitExecFileAsync(
        buildSearchBaseRefsArgv(normalizedQuery, limit, {
          remoteNames: options.remoteNames,
          patternGroup: options.patternGroup
        }),
        { cwd: path }
      ),
    () =>
      gitExecFileAsync(
        buildSearchBaseRefsArgv(normalizedQuery, limit, {
          excludeRemoteHead: false,
          remoteNames: options.remoteNames,
          patternGroup: options.patternGroup
        }),
        { cwd: path }
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

/**
 * A ref search either answered or could not be run. The distinction matters because an empty
 * `results` is a real answer -- this repo has no ref matching the query -- while `unverifiable`
 * means Git never reported, and a caller that shows "no matching branches" for that is asserting
 * something it does not know.
 *
 * `unverifiable` is the repo's verdict-layer word (see docs/reference/ssh-execution-boundary.md and
 * the `hostScope` fields in shared/runtime-worktree-contracts.ts); `unavailable` is reserved for the
 * raw process-evidence layer in main/daemon. Callers with no room for a third state use the array
 * adapters below.
 */
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

/** Array adapter for callers whose contract has no room for the unverifiable state. */
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
  if (!isRepoSearchRefsRequestLimit(limit)) {
    // Unreachable from the IPC and runtime callers, which both validate first -- but `ok` here would
    // mean "this repo has no matching ref" on the one path where nothing was ever asked.
    return { status: 'unverifiable', reason: `invalid ref search limit: ${String(limit)}` }
  }
  const boundedScanLimit = clampRepoSearchRefsScanLimit(limit)
  const normalizedQuery = normalizeRefSearchQuery(query)

  try {
    const remotes = await listRemoteNames(path)
    const tokens = getRefSearchTokens(normalizedQuery)
    if (tokens.length > 1) {
      const results = await Promise.all([
        runSearchBaseRefsGit(path, normalizedQuery, boundedScanLimit, {
          remoteNames: remotes,
          patternGroup: 'segmented'
        }),
        runSearchBaseRefsGit(path, normalizedQuery, boundedScanLimit, {
          remoteNames: remotes,
          patternGroup: 'branchRoot'
        })
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

    const result = await runSearchBaseRefsGit(path, normalizedQuery, boundedScanLimit, {
      remoteNames: remotes
    })
    return {
      status: 'ok',
      results: parseAndFilterSearchRefDetails(result.stdout, boundedScanLimit, remotes)
    }
  } catch (err) {
    console.warn('[searchBaseRefs] for-each-ref failed', { path, err })
    return { status: 'unverifiable', reason: describeBaseRefSearchFailure(err) }
  }
}

function describeBaseRefSearchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const firstLine = message.split('\n')[0]?.trim()
  return firstLine ? `git for-each-ref failed: ${firstLine}` : 'git for-each-ref failed'
}

/**
 * `[]` already reads as "no hint", not as "this repo has no remotes": every consumer branches on
 * `remoteNames.length > 0` and an empty list produces byte-identical `for-each-ref` argv to an
 * absent one, so a third state here would change no behaviour. Doctrine remedy 1 -- uncached, and
 * almost every consequence degrades toward showing more rows rather than fewer: `<remote>/HEAD`
 * filtering is lost and `resolveLocalBranchName` cannot strip a slash-containing remote's prefix.
 * The one exception is a ref under a slash-containing remote on a multi-token query: the branch-root
 * patterns fall back to a single-segment wildcard, which cannot reach past the first remote segment,
 * so `up/stream/feature/x` is unmatched. Accepted rather than fixed here -- the remedy belongs with
 * a remote-name-aware pattern builder, not with a swallow that re-asks on the next keystroke.
 */
export async function listRemoteNames(
  path: string,
  options: LocalGitExecOptions = {}
): Promise<string[]> {
  try {
    const { stdout } = await gitExecFileAsync(['remote'], gitExecOptions(path, options))
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function normalizeRefSearchQuery(query: string): string {
  return query.trim().replace(/[*?[\]\\]/g, '')
}

export { parseAndFilterSearchRefDetails, resolveConfiguredRemoteBranchName, resolveLocalBranchName }
