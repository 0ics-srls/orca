import type { MountAdapter } from './recording-scenario'
import { mountFixture, mountModelHook } from './model-hook-mount'
import type { operationModuleLoader } from './operation-module-loader'
import { githubDetailPayload } from './task-item-fixtures'
import { ISSUE_ROW, PROJECT_HOST, PROJECT_REPO, PROJECT_TABLE } from './task-project-board-fixtures'

/**
 * The GitHub Projects board's reads: which projects and views the account can see, one view's
 * table, a pasted project reference, one row's details, and the label, assignee and issue-type
 * pickers. Every `github.project.*` reply carries its own `{ok, error}` envelope inside an accepted
 * result, which the board reads itself — acceptance only decides whether there is a payload at all.
 */
export function taskProjectBoardReadMountAdapters(
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

  const boardLoad: MountAdapter = (context) => {
    const useActions = load<typeof import('../../tasks/use-mobile-tasks-project-loading-actions')>(
      'use-mobile-tasks-project-loading-actions.tsx'
    ).useMobileTasksProjectLoadingActions
    return mountModelHook(context, {
      useHook: (model) => useActions(model),
      fixture: {
        activeGitHubProject: {
          owner: 'owner',
          ownerType: 'ORGANIZATION',
          number: 3,
          host: PROJECT_HOST
        },
        activeGitHubProjectHost: PROJECT_HOST,
        activeGitHubProjectViewId: 'view-1',
        connState: 'connected',
        githubProjectPasteInput: 'https://github.com/orgs/owner/projects/3',
        githubProjectSettings: { recent: [], lastViewByProject: {}, activeProject: null },
        loadTasks: async () => {},
        persistGitHubProjectSettings: () => {},
        repoListReload: async () => [PROJECT_REPO],
        taskStateHydrated: true,
        tasksSupported: true,
        githubProjects: [],
        githubProjectViews: [],
        githubProjectTable: null,
        githubProjectError: '',
        githubProjectLoading: false,
        githubProjectPartialFailures: [],
        githubProjectPasteBusy: false,
        githubProjectPasteError: '',
        githubProjectSearch: '',
        appliedGithubProjectSearch: undefined,
        pendingGitHubProjectViewSelection: null,
        showGitHubProjectPicker: true,
        showGitHubProjectViewPicker: false
      },
      actions: ({ actions }) => ({
        projects: () => actions().loadGitHubProjects(),
        views: () =>
          actions().loadGitHubProjectViews(
            mountFixture({
              owner: 'owner',
              ownerType: 'ORGANIZATION',
              number: 3,
              host: PROJECT_HOST
            })
          ),
        table: () => actions().loadGitHubProjectTable(),
        paste: () => actions().resolveGitHubProjectFromInput()
      }),
      state: (model) => ({
        projects: model.githubProjects,
        views: model.githubProjectViews,
        table: model.githubProjectTable,
        error: model.githubProjectError,
        pasteError: model.githubProjectPasteError,
        loading: model.githubProjectLoading
      })
    })
  }

  const rowDetail: MountAdapter = (context) => {
    const useLoading = load<typeof import('../../tasks/use-mobile-tasks-project-detail-loading')>(
      'use-mobile-tasks-project-detail-loading.tsx'
    ).useMobileTasksProjectDetailLoading
    return mountModelHook(context, {
      useHook: (model) => useLoading(model),
      fixture: {
        ...boardFixture,
        projectRowDetail: null,
        tasksSupported: true,
        projectRowDetailLoading: false,
        projectFieldDrafts: {},
        projectTitleDraft: '',
        projectBodyDraft: '',
        projectCommentDraft: '',
        projectEditingCommentId: null,
        projectEditingCommentDraft: '',
        projectReviewersDraft: '',
        expandedPrFilePath: null,
        prFileCommentDrafts: {},
        prFileContents: {},
        prFileLoadingPath: null
      },
      actions: () => ({}),
      state: (model) => ({
        detail: model.projectRowDetail,
        loading: model.projectRowDetailLoading,
        error: model.projectRowDetailError
      })
    })
  }

  const rowMetadataLoad: MountAdapter = (context) => {
    const useLoading = load<typeof import('../../tasks/use-mobile-tasks-project-metadata-loading')>(
      'use-mobile-tasks-project-metadata-loading.tsx'
    ).useMobileTasksProjectMetadataLoading
    return mountModelHook(context, {
      useHook: (model) => useLoading(model),
      fixture: {
        activeGitHubProjectHost: PROJECT_HOST,
        projectIssueTypeRepository: 'owner/repo',
        projectMetadataRepository: 'owner/repo',
        projectMetadataSeedLogins: 'octocat',
        tasksSupported: true,
        projectAvailableLabels: [],
        projectLabelsLoading: false,
        projectLabelsError: '',
        projectAssignableUsers: [],
        projectAssignableUsersLoading: false,
        projectAssignableUsersError: '',
        projectIssueTypes: [],
        projectIssueTypesLoading: false,
        projectIssueTypesError: ''
      },
      actions: () => ({}),
      state: (model) => ({
        labels: model.projectAvailableLabels,
        labelsError: model.projectLabelsError,
        users: model.projectAssignableUsers,
        usersError: model.projectAssignableUsersError,
        types: model.projectIssueTypes,
        typesError: model.projectIssueTypesError
      })
    })
  }

  /** The board matches its rows against Orca repos by asking each repo for its owner/repo slug. */
  const repoSlugs: MountAdapter = (context) => {
    const useResolution = load<
      typeof import('../../tasks/use-mobile-tasks-project-repository-resolution')
    >(
      'use-mobile-tasks-project-repository-resolution.tsx'
    ).useMobileTasksProjectRepositoryResolution
    return mountModelHook(context, {
      useHook: (model) => useResolution(model),
      fixture: {
        ...boardFixture,
        actionItem: null,
        activeGitHubProject: {
          owner: 'owner',
          ownerType: 'ORGANIZATION',
          number: 3,
          host: PROJECT_HOST
        },
        connState: 'connected',
        detailPayload: null,
        githubMode: 'project',
        githubProjectSettings: { recent: [], lastViewByProject: {}, activeProject: null },
        githubProjectViews: [],
        githubRepoSlugCache: {},
        hostedRepos: [PROJECT_REPO],
        itemAssignableUsers: [],
        projectAssignableUsers: [],
        provider: 'github',
        taskStateHydrated: true,
        tasksSupported: true
      },
      actions: () => ({}),
      state: (model) => ({ cache: model.githubRepoSlugCache })
    })
  }

  return {
    'tasks.project-repo-slugs': repoSlugs,
    'tasks.project-board-load': boardLoad,
    'tasks.project-row-detail': rowDetail,
    'tasks.project-row-metadata-load': rowMetadataLoad
  }
}
