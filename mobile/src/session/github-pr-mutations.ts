import type { GitHubPRMergeMethod } from '../../../src/shared/github/pull-request-types'
import {
  githubPrAutoMergeSet,
  githubPrChecksRerun,
  githubPrMergeRun,
  githubPrReviewersRemove,
  githubPrReviewersRequest,
  githubPrStateSet,
  githubPrTitleSet
} from './github-pr-mutation-operations'
import {
  settleGithubPrConfirmation,
  settleGithubPrMutation,
  type GitHubPrMutationOutcome
} from './github-pr-mutation-outcome'
import { githubPrRequestParams, type GitHubPrRepoSlug } from './github-pr-repo-slug'
import type { MobileSessionRpcSender } from './mobile-session-rpc-sender'

// The PR action half of the github.* mutation surface: merge, auto-merge, open/close, reviewers,
// check reruns and the inline title edit. The conversation mutations live next door; both are
// re-exported here so consumers keep one entry point for the surface.

export type { GitHubPrMutationOutcome } from './github-pr-mutation-outcome'
export {
  fetchAddIssueComment,
  fetchAddPRReviewCommentReply,
  fetchDeleteIssueComment,
  fetchResolveReviewThread,
  fetchUpdateIssueComment
} from './github-pr-comment-mutations'

export function fetchMergePR(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: { prNumber: number; method?: GitHubPRMergeMethod; prRepo?: GitHubPrRepoSlug | null }
): Promise<GitHubPrMutationOutcome> {
  const params: Record<string, unknown> = { prNumber: args.prNumber }
  if (args.method) {
    params.method = args.method
  }
  return settleGithubPrMutation(githubPrMergeRun, () =>
    githubPrMergeRun.request(
      client,
      githubPrRequestParams(githubPrMergeRun.operation.method, worktreeId, params, {
        prRepo: args.prRepo
      })
    )
  )
}

// Edit the hosted-review title. The host returns a bare boolean (true on success),
// so it takes the confirmation shape rather than the status envelope.
export function fetchUpdatePRTitle(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: { prNumber: number; title: string; prRepo?: GitHubPrRepoSlug | null }
): Promise<GitHubPrMutationOutcome> {
  const params: Record<string, unknown> = { prNumber: args.prNumber, title: args.title }
  return settleGithubPrConfirmation(
    githubPrTitleSet,
    () =>
      githubPrTitleSet.request(
        client,
        githubPrRequestParams(githubPrTitleSet.operation.method, worktreeId, params, {
          prRepo: args.prRepo
        })
      ),
    'Failed to update title.'
  )
}

export function fetchSetPRAutoMerge(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: {
    prNumber: number
    enabled: boolean
    method?: GitHubPRMergeMethod
    prRepo?: GitHubPrRepoSlug | null
  }
): Promise<GitHubPrMutationOutcome> {
  const params: Record<string, unknown> = { prNumber: args.prNumber, enabled: args.enabled }
  if (args.method) {
    params.method = args.method
  }
  return settleGithubPrMutation(githubPrAutoMergeSet, () =>
    githubPrAutoMergeSet.request(
      client,
      githubPrRequestParams(githubPrAutoMergeSet.operation.method, worktreeId, params, {
        prRepo: args.prRepo
      })
    )
  )
}

export function fetchUpdatePRState(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: { prNumber: number; state: 'open' | 'closed'; prRepo?: GitHubPrRepoSlug | null }
): Promise<GitHubPrMutationOutcome> {
  return settleGithubPrMutation(githubPrStateSet, () =>
    githubPrStateSet.request(
      client,
      githubPrRequestParams(
        githubPrStateSet.operation.method,
        worktreeId,
        { prNumber: args.prNumber, updates: { state: args.state } },
        { prRepo: args.prRepo }
      )
    )
  )
}

export function fetchRequestPRReviewers(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: { prNumber: number; reviewers: string[]; prRepo?: GitHubPrRepoSlug | null }
): Promise<GitHubPrMutationOutcome> {
  return settleGithubPrMutation(githubPrReviewersRequest, () =>
    githubPrReviewersRequest.request(
      client,
      githubPrRequestParams(
        githubPrReviewersRequest.operation.method,
        worktreeId,
        { prNumber: args.prNumber, reviewers: args.reviewers },
        { prRepo: args.prRepo }
      )
    )
  )
}

export function fetchRemovePRReviewers(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: { prNumber: number; reviewers: string[]; prRepo?: GitHubPrRepoSlug | null }
): Promise<GitHubPrMutationOutcome> {
  return settleGithubPrMutation(githubPrReviewersRemove, () =>
    githubPrReviewersRemove.request(
      client,
      githubPrRequestParams(
        githubPrReviewersRemove.operation.method,
        worktreeId,
        { prNumber: args.prNumber, reviewers: args.reviewers },
        { prRepo: args.prRepo }
      )
    )
  )
}

export function fetchRerunPRChecks(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: {
    prNumber: number
    headSha?: string | null
    failedOnly?: boolean
    prRepo?: GitHubPrRepoSlug | null
  }
): Promise<GitHubPrMutationOutcome> {
  const params: Record<string, unknown> = { prNumber: args.prNumber }
  if (args.failedOnly !== undefined) {
    params.failedOnly = args.failedOnly
  }
  if (args.headSha) {
    params.headSha = args.headSha
  }
  return settleGithubPrMutation(githubPrChecksRerun, () =>
    githubPrChecksRerun.request(
      client,
      githubPrRequestParams(githubPrChecksRerun.operation.method, worktreeId, params, {
        prRepo: args.prRepo
      })
    )
  )
}
