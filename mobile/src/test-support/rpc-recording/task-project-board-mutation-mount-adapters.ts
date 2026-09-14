import type { MountAdapter } from './recording-scenario'
import { mountFixture, mountModelHook } from './model-hook-mount'
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
            mountFixture(ISSUE_ROW),
            mountFixture(STATUS_FIELD),
            mountFixture({
              singleSelectOptionId: 'option-1'
            })
          ),
        'clear-field': () =>
          actions().mutateProjectRowField(
            mountFixture(ISSUE_ROW),
            mountFixture(STATUS_FIELD),
            null
          ),
        'issue-type': () =>
          actions().mutateProjectRowIssueType(
            mountFixture(ISSUE_ROW),
            mountFixture({
              id: 'type-1',
              name: 'Bug'
            })
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
        reviewers: () => actions().requestProjectGitHubReviewers(mountFixture(PR_ROW)),
        checks: () => actions().refreshProjectGitHubChecks(mountFixture(PR_ROW)),
        rerun: () => actions().rerunProjectGitHubChecks(mountFixture(PR_ROW), true),
        viewed: () =>
          actions().toggleProjectGitHubFileViewed(
            mountFixture(PR_ROW),
            mountFixture({
              path: 'src/index.ts',
              status: 'modified',
              viewerViewedState: 'UNVIEWED'
            })
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
          actions().deleteProjectRowComment(
            mountFixture(PR_ROW),
            mountFixture({ ...REVIEW_COMMENT })
          ),
        thread: () =>
          actions().toggleProjectGitHubReviewThread(
            mountFixture(PR_ROW),
            mountFixture(REVIEW_COMMENT)
          ),
        'review-reply': () =>
          actions().replyToProjectGitHubComment(mountFixture(PR_ROW), mountFixture(REVIEW_COMMENT)),
        'issue-reply': () =>
          actions().replyToProjectGitHubComment(mountFixture(PR_ROW), mountFixture(ISSUE_COMMENT))
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
            actions().mutateProjectRowIssueOrPr(mountFixture(row), { title: 'Renamed' }),
          'add-comment': () => actions().addProjectRowComment(mountFixture(row)),
          'update-comment': () =>
            actions().updateProjectRowComment(mountFixture(row), mountFixture(REVIEW_COMMENT))
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
            mountFixture(PR_ROW),
            mountFixture({
              path: 'src/index.ts',
              status: 'modified'
            })
          ),
        'file-comment': () =>
          actions().addProjectGitHubFileReviewComment(
            mountFixture(PR_ROW),
            mountFixture({ path: 'src/index.ts', status: 'modified' }),
            12
          ),
        merge: () =>
          actions().mergeProjectGitHubPullRequest(mountFixture(PR_ROW), mountFixture('squash')),
        // The same hook also owns the item screen's open/close toggle, whose method is a local
        // two-literal ternary over the item type rather than a project-board call.
        'issue-state': () => actions().toggleGitHubStatus(mountFixture(GITHUB_ISSUE_ITEM)),
        'pr-state': () => actions().toggleGitHubStatus(mountFixture(GITHUB_PR_ITEM))
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
