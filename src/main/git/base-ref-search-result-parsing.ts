import type { BaseRefSearchResult } from '../../shared/repo-types'
import { isRemoteHeadRef } from '../../shared/hosted-review-refs'

export function parseAndFilterSearchRefDetails(
  stdout: string,
  limit: number,
  remotes: string[] = []
): BaseRefSearchResult[] {
  const seen = new Set<string>()
  const sortedRemotes = [...remotes].sort((a, b) => b.length - a.length)

  const canonicalShortRef = (fullRef: string, gitShortRef: string): string => {
    // Git's refname:short DWIM rule can strip a trailing `/HEAD` (for example,
    // `refs/remotes/origin/feature/HEAD` becomes `origin/feature`). Derive the
    // display name only for that case; otherwise Git's disambiguation prefixes
    // (such as `heads/` and `remotes/`) are significant and must be retained.
    if (
      fullRef.startsWith('refs/remotes/') &&
      fullRef.endsWith('/HEAD') &&
      !gitShortRef.endsWith('/HEAD')
    ) {
      return fullRef.slice('refs/remotes/'.length)
    }
    return gitShortRef
  }

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const nul = line.indexOf('\0')
      if (nul === -1) {
        return null
      }
      const full = line.slice(0, nul)
      const gitShort = line.slice(nul + 1)
      return { full, short: canonicalShortRef(full, gitShort) }
    })
    .filter((entry): entry is { full: string; short: string } => entry !== null)
    .filter(({ full }) => !isRemoteHeadRef(full, sortedRemotes))
    .filter(({ short }) => {
      if (seen.has(short)) {
        return false
      }
      seen.add(short)
      return true
    })
    .map(({ full, short }) => ({
      refName: short,
      localBranchName: resolveLocalBranchName(full, short, sortedRemotes)
    }))
    .slice(0, Math.max(0, limit))
}

export function resolveConfiguredRemoteBranchName(
  fullRef: string,
  longestFirstRemoteNames: readonly string[]
): string | null {
  const remoteRefPrefix = 'refs/remotes/'
  if (!fullRef.startsWith(remoteRefPrefix)) {
    return null
  }
  const remoteAndBranch = fullRef.slice(remoteRefPrefix.length)
  const remote = longestFirstRemoteNames.find((candidate) =>
    remoteAndBranch.startsWith(`${candidate}/`)
  )
  return remote ? remoteAndBranch.slice(remote.length + 1) || null : null
}

export function resolveLocalBranchName(
  fullRef: string,
  shortRef: string,
  remotes: string[]
): string {
  const remoteRefPrefix = 'refs/remotes/'
  if (!fullRef.startsWith(remoteRefPrefix)) {
    return shortRef
  }
  const configuredBranch = resolveConfiguredRemoteBranchName(fullRef, remotes)
  if (configuredBranch) {
    return configuredBranch
  }
  const remoteAndBranch = fullRef.slice(remoteRefPrefix.length)
  return remoteAndBranch.split('/').slice(1).join('/') || shortRef
}
