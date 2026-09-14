import type { MountAdapter } from './recording-scenario'
import { mountModelHook } from './model-hook-mount'
import type { operationModuleLoader } from './operation-module-loader'
import {
  GITHUB_ISSUE_ITEM,
  GITHUB_PR_ITEM,
  GITLAB_ISSUE_ITEM,
  GITLAB_MR_ITEM,
  ISSUE_COMMENT,
  LINEAR_ITEM,
  REVIEW_COMMENT,
  DETAIL_FILE,
  githubDetailPayload,
  gitlabDetailPayload,
  linearDetailPayload
} from './task-item-fixtures'

/**
 * The task detail screen's provider mutations: comments, replies, reviewers, checks, viewed state,
 * merges and status writes over GitHub, GitLab and Linear. Every one of these hooks keeps its own
 * per-site fallback string, so each family records the site rather than a shared merge path.
 */
export function taskItemMutationMountAdapters(
  modules: ReturnType<typeof operationModuleLoader>
): Record<string, MountAdapter> {
  const load = <T>(file: string): T => modules.load<T>(`mobile/src/tasks/${file}`)

  function commentReview(item: Record<string, unknown>, payload: Record<string, unknown>) {
    const useActions = load<
      typeof import('../../tasks/use-mobile-tasks-hosted-comment-review-actions')
    >('use-mobile-tasks-hosted-comment-review-actions.tsx').useMobileTasksHostedCommentReviewActions
    return (context: Parameters<MountAdapter>[0]) =>
      mountModelHook(context, {
        useHook: (model) => useActions(model),
        fixture: {
          copiedLinkResetTimerRef: { current: null },
          detailPayload: payload,
          itemCommentDraft: 'a comment',
          itemReviewersDraft: 'octocat',
          mutatingStatus: false,
          actionItem: item,
          items: [item],
          copiedLinkKey: null,
          error: ''
        },
        actions: ({ actions }) => ({
          comment: () => actions().addHostedItemComment(item as never),
          reviewers: () => actions().requestGitHubReviewers(item as never),
          checks: () => actions().refreshGitHubChecks(item as never)
        }),
        state: (model) => ({
          payload: model.detailPayload,
          item: model.actionItem,
          error: model.error,
          mutating: model.mutatingStatus,
          draft: model.itemCommentDraft
        })
      })
  }

  function replyMerge(item: Record<string, unknown>) {
    const useActions = load<
      typeof import('../../tasks/use-mobile-tasks-github-reply-merge-actions')
    >('use-mobile-tasks-github-reply-merge-actions.tsx').useMobileTasksGithubReplyMergeActions
    return (context: Parameters<MountAdapter>[0]) =>
      mountModelHook(context, {
        useHook: (model) => useActions(model),
        fixture: {
          itemReplyDrafts: { '501': 'a reply', 'comment-2': 'a reply' },
          loadTasks: async () => {},
          mutatingStatus: false,
          taskUiReady: true,
          actionItem: item,
          items: [item],
          detailPayload: item.provider === 'github' ? githubDetailPayload() : gitlabDetailPayload(),
          error: ''
        },
        actions: ({ actions }) => ({
          'review-reply': () =>
            actions().replyToGitHubComment(item as never, REVIEW_COMMENT as never),
          'issue-reply': () =>
            actions().replyToGitHubComment(item as never, ISSUE_COMMENT as never),
          merge: () => actions().mergeHostedReview(item as never, 'squash'),
          'linear-status': () =>
            actions().setLinearStatus(
              LINEAR_ITEM as never,
              {
                id: 'state-2',
                name: 'Done',
                type: 'completed',
                color: '#00ff00'
              } as never
            )
        }),
        state: (model) => ({
          payload: model.detailPayload,
          item: model.actionItem,
          items: model.items,
          error: model.error,
          mutating: model.mutatingStatus
        })
      })
  }

  function hostedStatus(item: Record<string, unknown>) {
    const useActions = load<
      typeof import('../../tasks/use-mobile-tasks-gitlab-github-status-actions')
    >('use-mobile-tasks-gitlab-github-status-actions.tsx').useMobileTasksGitlabGithubStatusActions
    return (context: Parameters<MountAdapter>[0]) =>
      mountModelHook(context, {
        useHook: (model) => useActions(model),
        fixture: {
          detailPayload: item.provider === 'github' ? githubDetailPayload() : gitlabDetailPayload(),
          loadTasks: async () => {},
          mutatingStatus: false,
          actionItem: item,
          items: [item],
          error: ''
        },
        actions: ({ actions }) => ({
          'gitlab-status': () => actions().toggleGitLabStatus(item as never),
          'github-metadata': () =>
            actions().updateGitHubIssueMetadata(GITHUB_ISSUE_ITEM as never, {
              title: 'Renamed',
              addLabels: ['triage'],
              removeLabels: ['bug']
            })
        }),
        state: (model) => ({
          payload: model.detailPayload,
          item: model.actionItem,
          items: model.items,
          error: model.error,
          mutating: model.mutatingStatus
        })
      })
  }

  function hostedMetadata(item: Record<string, unknown>) {
    const useActions = load<typeof import('../../tasks/use-mobile-tasks-hosted-metadata-actions')>(
      'use-mobile-tasks-hosted-metadata-actions.tsx'
    ).useMobileTasksHostedMetadataActions
    return (context: Parameters<MountAdapter>[0]) =>
      mountModelHook(context, {
        useHook: (model) => useActions(model),
        fixture: {
          detailPayload: item.provider === 'github' ? githubDetailPayload() : gitlabDetailPayload(),
          loadTasks: async () => {},
          mutatingStatus: false,
          actionItem: item,
          items: [item],
          error: ''
        },
        actions: ({ actions }) => ({
          'update-pr': () =>
            actions().updateGitHubPullRequestMetadata(GITHUB_PR_ITEM as never, {
              title: 'Renamed',
              body: 'new body'
            }),
          'update-gitlab': () =>
            actions().updateGitLabIssueMetadata(item as never, {
              title: 'Renamed',
              addLabels: ['triage']
            })
        }),
        state: (model) => ({
          payload: model.detailPayload,
          item: model.actionItem,
          items: model.items,
          error: model.error,
          mutating: model.mutatingStatus
        })
      })
  }

  const checkFiles: MountAdapter = (context) => {
    const useActions = load<
      typeof import('../../tasks/use-mobile-tasks-github-check-file-actions')
    >('use-mobile-tasks-github-check-file-actions.tsx').useMobileTasksGithubCheckFileActions
    return mountModelHook(context, {
      useHook: (model) => useActions(model),
      fixture: {
        detailPayload: githubDetailPayload(),
        expandedPrFilePath: null,
        mutatingStatus: false,
        prFileCommentDrafts: { 'src/index.ts:12': 'a review comment' },
        prFileContents: {},
        detailRefreshSeq: 0,
        error: ''
      },
      actions: ({ actions }) => ({
        rerun: () => actions().rerunGitHubChecks(GITHUB_PR_ITEM as never, true),
        viewed: () =>
          actions().toggleGitHubFileViewed(GITHUB_PR_ITEM as never, DETAIL_FILE as never),
        thread: () =>
          actions().toggleGitHubReviewThread(GITHUB_PR_ITEM as never, REVIEW_COMMENT as never),
        expand: () =>
          actions().toggleGitHubFileExpansion(GITHUB_PR_ITEM as never, DETAIL_FILE as never),
        'file-comment': () =>
          actions().addGitHubFileReviewComment(GITHUB_PR_ITEM as never, DETAIL_FILE as never, 12)
      }),
      state: (model) => ({
        payload: model.detailPayload,
        contents: model.prFileContents,
        drafts: model.prFileCommentDrafts,
        refreshSeq: model.detailRefreshSeq,
        error: model.error,
        mutating: model.mutatingStatus
      })
    })
  }

  const linearItem: MountAdapter = (context) => {
    const useActions = load<typeof import('../../tasks/use-mobile-tasks-linear-item-actions')>(
      'use-mobile-tasks-linear-item-actions.tsx'
    ).useMobileTasksLinearItemActions
    return mountModelHook(context, {
      useHook: (model) => useActions(model),
      fixture: {
        linearCommentDraft: 'a linear comment',
        linearSubIssueTitle: 'A sub-issue',
        mutatingStatus: false,
        actionItem: LINEAR_ITEM,
        detailPayload: linearDetailPayload(),
        error: ''
      },
      actions: ({ actions }) => ({
        comment: () => actions().addLinearComment(LINEAR_ITEM as never),
        'sub-issue-open': () =>
          actions().openLinearSubIssue(
            { id: 'issue-2', identifier: 'ENG-2' } as never,
            'linear-workspace'
          ),
        'sub-issue-create': () => actions().createLinearSubIssue(LINEAR_ITEM as never)
      }),
      state: (model) => ({
        payload: model.detailPayload,
        item: model.actionItem,
        error: model.error,
        mutating: model.mutatingStatus
      })
    })
  }

  return {
    'tasks.item-comment-github': commentReview(GITHUB_ISSUE_ITEM, githubDetailPayload()),
    'tasks.item-review-github': commentReview(GITHUB_PR_ITEM, githubDetailPayload()),
    'tasks.item-comment-gitlab': commentReview(GITLAB_ISSUE_ITEM, gitlabDetailPayload()),
    'tasks.item-comment-gitlab-mr': commentReview(GITLAB_MR_ITEM, gitlabDetailPayload()),
    'tasks.item-checks-files-github': checkFiles,
    'tasks.item-reply-merge-github': replyMerge(GITHUB_PR_ITEM),
    'tasks.item-merge-gitlab': replyMerge(GITLAB_MR_ITEM),
    'tasks.item-status-gitlab': hostedStatus(GITLAB_ISSUE_ITEM),
    'tasks.item-status-gitlab-mr': hostedStatus(GITLAB_MR_ITEM),
    'tasks.item-metadata-github': hostedMetadata(GITHUB_PR_ITEM),
    'tasks.item-metadata-gitlab': hostedMetadata(GITLAB_ISSUE_ITEM),
    'tasks.item-metadata-gitlab-mr': hostedMetadata(GITLAB_MR_ITEM),
    'tasks.linear-item-actions': linearItem
  }
}
