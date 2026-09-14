import {
  githubPrIssueCommentAdd,
  githubPrIssueCommentDelete,
  githubPrIssueCommentEdit,
  githubPrReviewCommentReplyAdd,
  githubPrReviewThreadResolve
} from './github-pr-mutation-operations'
import {
  settleGithubPrConfirmation,
  settleGithubPrMutation,
  type GitHubPrMutationOutcome
} from './github-pr-mutation-outcome'
import {
  githubPrRepoSlugParam,
  githubPrRequestParams,
  type GitHubPrRepoSlug
} from './github-pr-repo-slug'
import type { MobileSessionRpcSender } from './mobile-session-rpc-sender'

// The conversation half of the github.* PR mutation surface: review-thread replies, root comments,
// thread resolution and the slug-addressed comment edit/delete. Split from the PR action mutations
// because the two are driven by different hooks and this file was over the max-lines budget.

// Reply within a review thread. Host returns GitHubCommentResult
// (`{ ok, comment } | { ok:false, error }`), which the status reader admits.
// We refetch afterward, so the returned comment is unused.
export function fetchAddPRReviewCommentReply(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: {
    prNumber: number
    commentId: number
    body: string
    threadId?: string
    path?: string
    line?: number
    prRepo?: GitHubPrRepoSlug | null
  }
): Promise<GitHubPrMutationOutcome> {
  const params: Record<string, unknown> = {
    prNumber: args.prNumber,
    commentId: args.commentId,
    body: args.body
  }
  if (args.threadId) {
    params.threadId = args.threadId
  }
  if (args.path) {
    params.path = args.path
  }
  if (typeof args.line === 'number') {
    params.line = args.line
  }
  return settleGithubPrMutation(githubPrReviewCommentReplyAdd, () =>
    githubPrReviewCommentReplyAdd.request(
      client,
      githubPrRequestParams(githubPrReviewCommentReplyAdd.operation.method, worktreeId, params, {
        prRepo: args.prRepo
      })
    )
  )
}

// Add a root conversation comment to the PR. Host returns GitHubCommentResult.
export function fetchAddIssueComment(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: { prNumber: number; body: string; prRepo?: GitHubPrRepoSlug | null }
): Promise<GitHubPrMutationOutcome> {
  const params: Record<string, unknown> = {
    number: args.prNumber,
    body: args.body,
    type: 'pr'
  }
  return settleGithubPrMutation(githubPrIssueCommentAdd, () =>
    githubPrIssueCommentAdd.request(
      client,
      githubPrRequestParams(githubPrIssueCommentAdd.operation.method, worktreeId, params, {
        prRepo: args.prRepo
      })
    )
  )
}

// Resolve/unresolve a review thread. `resolve` picks the direction (the host runs
// the matching GraphQL mutation). Unlike the comment mutations, the host returns a
// bare boolean, so a falsy result is a failure rather than the "no status" success.
export function fetchResolveReviewThread(
  client: MobileSessionRpcSender,
  worktreeId: string,
  args: { threadId: string; resolve: boolean; prRepo?: GitHubPrRepoSlug | null }
): Promise<GitHubPrMutationOutcome> {
  return settleGithubPrConfirmation(
    githubPrReviewThreadResolve,
    () =>
      githubPrReviewThreadResolve.request(
        client,
        githubPrRequestParams(
          githubPrReviewThreadResolve.operation.method,
          worktreeId,
          { threadId: args.threadId, resolve: args.resolve },
          { prRepo: args.prRepo }
        )
      ),
    'Failed to update review thread.'
  )
}

// Edit a root conversation (issue) comment. The host RPC is slug-addressed
// (owner/repo/commentId), not worktree-addressed, so the params are passed
// directly rather than via the PR-scoped builder. Host returns the
// GitHubProjectMutationResult `{ ok }` envelope the status reader admits.
export function fetchUpdateIssueComment(
  client: MobileSessionRpcSender,
  args: { owner: string; repo: string; host?: string; commentId: number; body: string }
): Promise<GitHubPrMutationOutcome> {
  return settleGithubPrMutation(githubPrIssueCommentEdit, () =>
    githubPrIssueCommentEdit.request(client, {
      ...githubPrRepoSlugParam(args),
      commentId: args.commentId,
      body: args.body
    })
  )
}

// Delete a root conversation (issue) comment. Slug-addressed like the edit wrapper.
export function fetchDeleteIssueComment(
  client: MobileSessionRpcSender,
  args: { owner: string; repo: string; host?: string; commentId: number }
): Promise<GitHubPrMutationOutcome> {
  return settleGithubPrMutation(githubPrIssueCommentDelete, () =>
    githubPrIssueCommentDelete.request(client, {
      ...githubPrRepoSlugParam(args),
      commentId: args.commentId
    })
  )
}
