import type { MountAdapter } from './recording-scenario'
import { mountModelHook } from './model-hook-mount'
import type { operationModuleLoader } from './operation-module-loader'
import {
  GITHUB_ISSUE_ITEM,
  GITHUB_PR_ITEM,
  ISSUE_COMMENT,
  REVIEW_COMMENT,
  githubDetailPayload
} from './task-item-fixtures'
import {
  ISSUE_ROW,
  PR_ROW,
  PROJECT_HOST,
  PROJECT_REPO,
  PROJECT_TABLE,
  STATUS_FIELD
} from './task-project-board-fixtures'

/**
 * The GitHub Projects board's row mutations: field values, issue type, reviewers and checks, review
 * threads and replies, comments, file contents and merge. Each keeps its own fallback string, so
 * the families record the site rather than a shared mutation path.
 */
export function taskProjectBoardMutationMountAdapters(
  modules: ReturnType<typeof operationModuleLoader>
): Record<string, MountAdapter> {
  const load = <T>(file: string): T => modules.load<T>(`mobile/src/tasks/${file}`)
  const boardFixture = {
    activeGitHubProjectHost: PROJECT_HOST,
    findProjectRowRepo: () => PROJECT_REPO,
    projectMutating: false,
    projectRowDetail: githubDetailPayload(),
    projectRowItem: ISSUE_ROW,
    githubProjectTable: PROJECT_TABLE,
    projectRowDetailError: '',
    projectRowDetailRefreshSeq: 0
  }

  const rowFields: MountAdapter = (context) => {
    const useActions = load<typeof import('../../tasks/use-mobile-tasks-project-metadata-actions')>(
      'use-mobile-tasks-project-metadata-actions.tsx'
    ).useMobileTasksProjectMetadataActions
    return mountModelHook(context, {
      useHook: (model) => useActions(model),
      fixture: { ...boardFixture, projectFieldDrafts: {} },
      actions: ({ actions }) => ({
        'set-field': () =>
          actions().mutateProjectRowField(
            ISSUE_ROW as never,
            STATUS_FIELD as never,
            {
              singleSelectOptionId: 'option-1'
            } as never
          ),
        'clear-field': () =>
          actions().mutateProjectRowField(ISSUE_ROW as never, STATUS_FIELD as never, null),
        'issue-type': () =>
          actions().mutateProjectRowIssueType(
            ISSUE_ROW as never,
            {
              id: 'type-1',
              name: 'Bug'
            } as never
          )
      }),
      state: (model) => ({
        row: model.projectRowItem,
        table: model.githubProjectTable,
        error: model.projectRowDetailError,
        mutating: model.projectMutating
      })
    })
  }

  const rowReviewChecks: MountAdapter = (context) => {
    const useActions = load<
      typeof import('../../tasks/use-mobile-tasks-project-review-check-actions')
    >('use-mobile-tasks-project-review-check-actions.tsx').useMobileTasksProjectReviewCheckActions
    return mountModelHook(context, {
      useHook: (model) => useActions(model),
      fixture: { ...boardFixture, projectRowItem: PR_ROW, projectReviewersDraft: 'octocat' },
      actions: ({ actions }) => ({
        reviewers: () => actions().requestProjectGitHubReviewers(PR_ROW as never),
        checks: () => actions().refreshProjectGitHubChecks(PR_ROW as never),
        rerun: () => actions().rerunProjectGitHubChecks(PR_ROW as never, true),
        viewed: () =>
          actions().toggleProjectGitHubFileViewed(
            PR_ROW as never,
            {
              path: 'src/index.ts',
              status: 'modified',
              viewerViewedState: 'UNVIEWED'
            } as never
          )
      }),
      state: (model) => ({
        detail: model.projectRowDetail,
        draft: model.projectReviewersDraft,
        refreshSeq: model.projectRowDetailRefreshSeq,
        error: model.projectRowDetailError,
        mutating: model.projectMutating
      })
    })
  }

  const rowThreads: MountAdapter = (context) => {
    const useActions = load<
      typeof import('../../tasks/use-mobile-tasks-project-thread-reply-actions')
    >('use-mobile-tasks-project-thread-reply-actions.tsx').useMobileTasksProjectThreadReplyActions
    return mountModelHook(context, {
      useHook: (model) => useActions(model),
      fixture: {
        ...boardFixture,
        projectRowItem: PR_ROW,
        itemReplyDrafts: { '501': 'a reply', 'comment-2': 'a reply' },
        projectEditingCommentId: null,
        projectEditingCommentDraft: ''
      },
      actions: ({ actions }) => ({
        'delete-comment': () =>
          actions().deleteProjectRowComment(PR_ROW as never, { ...REVIEW_COMMENT } as never),
        thread: () =>
          actions().toggleProjectGitHubReviewThread(PR_ROW as never, REVIEW_COMMENT as never),
        'review-reply': () =>
          actions().replyToProjectGitHubComment(PR_ROW as never, REVIEW_COMMENT as never),
        'issue-reply': () =>
          actions().replyToProjectGitHubComment(PR_ROW as never, ISSUE_COMMENT as never)
      }),
      state: (model) => ({
        detail: model.projectRowDetail,
        error: model.projectRowDetailError,
        mutating: model.projectMutating
      })
    })
  }

  function rowComments(row: Record<string, unknown>) {
    const useActions = load<
      typeof import('../../tasks/use-mobile-tasks-project-workspace-comment-actions')
    >(
      'use-mobile-tasks-project-workspace-comment-actions.tsx'
    ).useMobileTasksProjectWorkspaceCommentActions
    return (context: Parameters<MountAdapter>[0]) =>
      mountModelHook(context, {
        useHook: (model) => useActions(model),
        fixture: {
          ...boardFixture,
          projectRowItem: row,
          openWorkspaceCreate: () => {},
          projectCommentDraft: 'a project comment',
          projectEditingCommentDraft: 'an edited comment',
          projectEditingCommentId: '501',
          tasksSupported: true,
          error: '',
          projectRepoNotInOrca: null
        },
        actions: ({ actions }) => ({
          'update-item': () =>
            actions().mutateProjectRowIssueOrPr(row as never, { title: 'Renamed' }),
          'add-comment': () => actions().addProjectRowComment(row as never),
          'update-comment': () =>
            actions().updateProjectRowComment(row as never, REVIEW_COMMENT as never)
        }),
        state: (model) => ({
          row: model.projectRowItem,
          detail: model.projectRowDetail,
          error: model.projectRowDetailError,
          mutating: model.projectMutating
        })
      })
  }

  const rowFilesMerge: MountAdapter = (context) => {
    const useActions = load<
      typeof import('../../tasks/use-mobile-tasks-project-file-merge-actions')
    >('use-mobile-tasks-project-file-merge-actions.tsx').useMobileTasksProjectFileMergeActions
    return mountModelHook(context, {
      useHook: (model) => useActions(model),
      fixture: {
        ...boardFixture,
        projectRowItem: PR_ROW,
        expandedPrFilePath: null,
        loadTasks: async () => {},
        mutatingStatus: false,
        prFileCommentDrafts: { 'src/index.ts:12': 'a review comment' },
        prFileContents: {},
        prFileLoadingPath: null,
        actionItem: null,
        error: ''
      },
      actions: ({ actions }) => ({
        expand: () =>
          actions().toggleProjectGitHubFileExpansion(
            PR_ROW as never,
            {
              path: 'src/index.ts',
              status: 'modified'
            } as never
          ),
        'file-comment': () =>
          actions().addProjectGitHubFileReviewComment(
            PR_ROW as never,
            { path: 'src/index.ts', status: 'modified' } as never,
            12
          ),
        merge: () => actions().mergeProjectGitHubPullRequest(PR_ROW as never, 'squash' as never),
        // The same hook also owns the item screen's open/close toggle, whose method is a local
        // two-literal ternary over the item type rather than a project-board call.
        'issue-state': () => actions().toggleGitHubStatus(GITHUB_ISSUE_ITEM as never),
        'pr-state': () => actions().toggleGitHubStatus(GITHUB_PR_ITEM as never)
      }),
      state: (model) => ({
        row: model.projectRowItem,
        contents: model.prFileContents,
        error: model.projectRowDetailError,
        mutating: model.projectMutating
      })
    })
  }

  return {
    'tasks.project-row-fields': rowFields,
    'tasks.project-row-review-checks': rowReviewChecks,
    'tasks.project-row-threads': rowThreads,
    'tasks.project-row-comments-issue': rowComments(ISSUE_ROW),
    'tasks.project-row-comments-pr': rowComments(PR_ROW),
    'tasks.project-row-files-merge': rowFilesMerge
  }
}
