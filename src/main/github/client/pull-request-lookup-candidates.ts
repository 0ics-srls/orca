import type { IssueSourcePreference } from '../../../shared/repo-types'
import type { LocalGitExecOptions } from '../gh-utils'
import {
  getOriginGitHubApiRepository,
  resolveGitHubApiRepositoryCandidates
} from '../github-api-repository'
import type { GitHubOwnerRepo } from '../../../shared/github/pull-request-types'

// resolvePrWorkItemSource list semantics.
export async function resolvePullRequestLookupCandidates(
  repoPath: string,
  preference: IssueSourcePreference | undefined,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubOwnerRepo[]> {
  if (preference === 'origin') {
    const origin = await getOriginGitHubApiRepository(repoPath, connectionId, localGitOptions)
    return origin ? [origin] : []
  }
  return (await resolveGitHubApiRepositoryCandidates(repoPath, connectionId, localGitOptions))
    .candidates
}
