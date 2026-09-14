import type { MountAdapter } from './recording-scenario'
import { mountModelHook } from './model-hook-mount'
import type { operationModuleLoader } from './operation-module-loader'
import {
  GITHUB_ISSUE_ITEM,
  HOSTED_REPO,
  GITHUB_PR_ITEM,
  GITLAB_ISSUE_ITEM,
  LINEAR_ITEM,
  githubDetailPayload
} from './task-item-fixtures'

/**
 * One task item's reads: its provider details, the label and assignee pickers behind the metadata
 * sheet, and the Linear team context the composer and the status picker share. Each of these hooks
 * keeps a `stale` guard between the request and the state commit, so the families record that the
 * guard still sits there rather than asserting it.
 */
export function taskItemDetailMountAdapters(
  modules: ReturnType<typeof operationModuleLoader>
): Record<string, MountAdapter> {
  const load = <T>(file: string): T => modules.load<T>(`mobile/src/tasks/${file}`)

  function itemDetail(item: Record<string, unknown>) {
    const useDetail = load<typeof import('../../tasks/use-mobile-tasks-item-detail-loading')>(
      'use-mobile-tasks-item-detail-loading.tsx'
    ).useMobileTasksItemDetailLoading
    return (context: Parameters<MountAdapter>[0]) =>
      mountModelHook(context, {
        useHook: (model) => useDetail(model),
        fixture: {
          actionItem: item,
          detailRefreshSeq: 0,
          tasksSupported: true,
          detailLoading: false,
          detailError: '',
          detailPayload: null,
          items: [item]
        },
        actions: () => ({}),
        state: (model) => ({
          loading: model.detailLoading,
          error: model.detailError,
          payload: model.detailPayload,
          item: model.actionItem,
          items: model.items
        })
      })
  }

  const itemMetadata: MountAdapter = (context) => {
    const useEffects = load<
      typeof import('../../tasks/use-mobile-tasks-item-detail-metadata-effects')
    >('use-mobile-tasks-item-detail-metadata-effects.tsx').useMobileTasksItemDetailMetadataEffects
    return mountModelHook(context, {
      useHook: (model) => useEffects(model),
      fixture: {
        actionItem: GITHUB_ISSUE_ITEM,
        detailPayload: githubDetailPayload(),
        tasksSupported: true,
        itemAvailableLabels: [],
        itemAvailableLabelsError: '',
        itemLabelsLoading: false,
        itemLabelsError: '',
        itemAssignableUsers: [],
        itemAssignableUsersLoading: false,
        itemAssignableUsersError: '',
        itemBodyDraft: ''
      },
      actions: () => ({}),
      state: (model) => ({
        labels: model.itemAvailableLabels,
        labelsError: model.itemLabelsError,
        labelsLoading: model.itemLabelsLoading,
        users: model.itemAssignableUsers,
        usersError: model.itemAssignableUsersError,
        usersLoading: model.itemAssignableUsersLoading
      })
    })
  }

  const linearTeamContext: MountAdapter = (context) => {
    const useEffects = load<typeof import('../../tasks/use-mobile-tasks-list-and-detail-effects')>(
      'use-mobile-tasks-list-and-detail-effects.tsx'
    ).useMobileTasksListAndDetailEffects
    return mountModelHook(context, {
      useHook: (model) => useEffects(model),
      fixture: {
        actionItem: null,
        activeGitHubProject: null,
        activeGitHubProjectViewId: null,
        appliedGithubProjectSearch: undefined,
        appliedQuery: '',
        connState: 'connected',
        copiedLinkResetTimerRef: { current: null },
        githubKind: 'issues',
        githubMode: 'items',
        githubPreset: 'issues',
        hostedRepos: [HOSTED_REPO],
        linearConnected: true,
        linearFilter: 'all',
        linearMetadataItem: null,
        loadGitHubProjectTable: async () => {},
        loadGitHubProjects: async () => {},
        loadLinearContext: async () => {},
        loadTasks: async () => {},
        persistTaskResumeState: () => {},
        provider: 'linear',
        query: '',
        refreshTasks: () => {},
        selectGitHubProject: async () => {},
        showCreateTask: false,
        showGitHubProjectPicker: false,
        taskStateHydrated: true,
        taskUiReady: true,
        tasksSupported: true,
        linearTeams: [],
        linearStates: [],
        linearStatesLoading: false,
        createTeamId: null
      },
      actions: ({ model, update }) => ({
        'open-composer': () => {
          model.showCreateTask = true
          return update()
        },
        'select-metadata-item': () => {
          model.linearMetadataItem = LINEAR_ITEM
          return update()
        }
      }),
      state: (model) => ({
        teams: model.linearTeams,
        createTeamId: model.createTeamId,
        states: model.linearStates,
        statesLoading: model.linearStatesLoading
      })
    })
  }

  return {
    'tasks.item-detail-github': itemDetail(GITHUB_PR_ITEM),
    'tasks.item-detail-gitlab': itemDetail(GITLAB_ISSUE_ITEM),
    // The Linear arm with its issue leg answered. The b3 seed refuses that leg, so its matrix
    // never reaches the comment leg's acceptance: the issue error is raised first either way.
    'tasks.item-detail-linear': itemDetail(LINEAR_ITEM),
    'tasks.item-detail-metadata': itemMetadata,
    'tasks.linear-team-context': linearTeamContext
  }
}
