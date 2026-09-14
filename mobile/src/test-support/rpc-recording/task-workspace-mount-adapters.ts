import type { MountAdapter } from './recording-scenario'
import { hookMount, performHookAction } from './hook-mount'
import { observableModel, projectObservable } from './observable-model'
import type { operationModuleLoader } from './operation-module-loader'

const REPO = 'repo-1'
const REPO_SELECTOR = `id:${REPO}`

/**
 * The task screen's workspace-creation senders. Four are exported async functions that take a
 * client, so they mount as plain calls; the other three are model-chained hooks, mounted the same
 * way the settings adapters mount theirs — a fixture model supplying only the members the hook
 * destructures, with every setter recorded as an effect.
 */
export function taskWorkspaceMountAdapters(
  modules: ReturnType<typeof operationModuleLoader>
): Record<string, MountAdapter> {
  return {
    'tasks.worktree-create-retry': ({ client }) => {
      const create = modules.load<typeof import('../../tasks/worktree-create-retry')>(
        'mobile/src/tasks/worktree-create-retry.ts'
      ).createWorktreeWithNameRetry
      let outcome: unknown = 'uncreated'
      let minted = 0
      return {
        action: (_name, args) =>
          create({
            client,
            baseName: String(args.name ?? 'kestrel'),
            buildParams: (candidate: string) => ({ repo: REPO_SELECTOR, name: candidate }),
            // A resolved probe, because the create path awaits it before the first send.
            worktreeCreateIdempotency: Promise.resolve(
              args.idempotency === false ? false : { dedupeTtlMs: 60_000 }
            ),
            ...(args.maxAttempts === undefined ? {} : { maxAttempts: Number(args.maxAttempts) }),
            mintMutationId: () => `mutation-${++minted}`
          }).then((value: unknown) => {
            outcome = value
            return value
          }),
        state: () => ({ outcome }),
        dispose: () => {}
      }
    },
    'tasks.worktree-capabilities': ({ client }) => {
      const read = modules.load<typeof import('../../tasks/worktree-create-capability')>(
        'mobile/src/tasks/worktree-create-capability.ts'
      ).readNewWorktreeRuntimeCapabilities
      let capabilities: unknown = 'unprobed'
      return {
        action: () =>
          read(client).then((value: unknown) => {
            capabilities = value
            return value
          }),
        state: () => ({ capabilities }),
        dispose: () => {}
      }
    },
    'tasks.composer-hosted-base': ({ client }) => {
      const resolve = modules.load<typeof import('../../tasks/composer-source-base-resolve')>(
        'mobile/src/tasks/composer-source-base-resolve.ts'
      )
      let prBase: unknown = 'unresolved'
      let mrBase: unknown = 'unresolved'
      return {
        action(name) {
          if (name === 'mr-base') {
            return resolve
              .resolveComposerMrBase({ client, repoId: REPO, mrIid: 7, sourceBranch: 'feature' })
              .then((value: unknown) => {
                mrBase = value
                return value
              })
          }
          return resolve
            .resolveComposerPrBase({ client, repoId: REPO, prNumber: 12, headRefName: 'feature' })
            .then((value: unknown) => {
              prBase = value
              return value
            })
        },
        state: () => ({ prBase, mrBase }),
        dispose: () => {}
      }
    },
    'tasks.setup-hook-trust': ({ client }) => {
      const persist = modules.load<typeof import('../../tasks/setup-hook-trust')>(
        'mobile/src/tasks/setup-hook-trust.ts'
      ).persistSetupHookTrustApproval
      let trust: unknown = 'unapproved'
      return {
        action: (_name, args) =>
          persist({
            client,
            trust: {},
            repoId: REPO,
            contentHash: 'hash-1',
            alwaysTrust: args.always === true
          }).then((value: unknown) => {
            trust = value
            return value
          }),
        state: () => ({ trust }),
        dispose: () => {}
      }
    },
    'tasks.smart-source-search': ({ client }) => {
      const search = modules.load<typeof import('../../tasks/smart-source-search-requests')>(
        'mobile/src/tasks/smart-source-search-requests.ts'
      )
      const results: Record<string, unknown> = {}
      return {
        action(name, args) {
          const query = String(args.query ?? 'bug')
          const request =
            name === 'gitlab'
              ? search.searchGitLabItems(client, REPO, query, 'opened')
              : name === 'linear'
                ? search.searchLinearIssues(
                    client,
                    query,
                    args.workspace === null ? null : String(args.workspace ?? 'linear-workspace')
                  )
                : name === 'branches'
                  ? search.searchBranches(client, REPO, query)
                  : search.searchGitHubItems(client, REPO, query)
          return request.then((value: unknown) => {
            results[name] = value
            return value
          })
        },
        state: () => ({ ...results }),
        dispose: () => {}
      }
    },
    'tasks.paste-lookup': ({ client }) => {
      const paste = modules.load<typeof import('../../tasks/smart-source-paste-intent')>(
        'mobile/src/tasks/smart-source-paste-intent.ts'
      )
      const slugCache = new Map<string, { owner: string; repo: string; host?: string } | null>()
      const repos = [
        { id: REPO, displayName: 'Repo', slug: null },
        { id: 'repo-2', displayName: 'Other', slug: null }
      ]
      const results: Record<string, unknown> = {}
      return {
        action(name) {
          const request =
            name === 'by-number'
              ? paste.lookupGitHubItemByNumber(client, REPO, 12)
              : name === 'by-slug'
                ? paste.lookupGitHubItemByOwnerRepo(
                    client,
                    REPO,
                    { owner: 'owner', repo: 'repo' },
                    12,
                    'issue'
                  )
                : name === 'gitlab-path'
                  ? paste.lookupGitLabItemByPath(client, REPO, {
                      slug: { host: 'gitlab.com', path: 'group/project' },
                      number: 7,
                      type: 'issue'
                    })
                  : paste.findRepoMatchingSlugForPaste(
                      client,
                      repos,
                      { owner: 'owner', repo: 'repo' },
                      slugCache
                    )
          return request.then((value: unknown) => {
            results[name] = value
            return value
          })
        },
        state: () => ({ ...results, cache: [...slugCache] }),
        dispose: () => {}
      }
    },
    'tasks.workspace-source': (context) => {
      const useEffects = modules.load<
        typeof import('../../tasks/use-mobile-tasks-workspace-source-effects')
      >(
        'mobile/src/tasks/use-mobile-tasks-workspace-source-effects.tsx'
      ).useMobileTasksWorkspaceSourceEffects
      const model = observableModel(context, {
        client: context.client,
        tasksSupported: true,
        workspaceCreateDraft: { key: 'linear:1' },
        workspaceCreateTargetRepo: { id: REPO, displayName: 'Repo' },
        workspaceSparseReloadKey: 0,
        workspaceBaseBranchQuery: '',
        showWorkspaceBaseBranchPicker: false,
        workspaceSparsePresets: [],
        workspaceSparsePresetsLoaded: false,
        workspaceSparsePresetsLoading: false,
        workspaceSparsePresetsError: '',
        workspaceSparsePresetId: null,
        workspaceSparseDraft: null,
        workspaceBaseBranchResults: [],
        workspaceBaseBranchLoading: false,
        workspaceBaseBranchError: ''
      })
      const hook = hookMount(() => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the recorder supplies only the members the hook reads.
        useEffects(model as unknown as Parameters<typeof useEffects>[0])
      })
      return {
        action(name, args) {
          if (name === 'mount') {
            return hook.mount()
          }
          if (name === 'unmount') {
            return hook.unmount()
          }
          if (name === 'branch-query') {
            model.showWorkspaceBaseBranchPicker = true
            model.workspaceBaseBranchQuery = String(args.query ?? 'main')
            return hook.update()
          }
          throw new Error(`Unknown workspace source action: ${name}`)
        },
        state: () =>
          projectObservable({
            presets: model.workspaceSparsePresets,
            presetsLoaded: model.workspaceSparsePresetsLoaded,
            presetsError: model.workspaceSparsePresetsError,
            branches: model.workspaceBaseBranchResults,
            branchError: model.workspaceBaseBranchError
          }),
        dispose: hook.unmount
      }
    },
    'tasks.workspace-sparse': (context) => {
      const useSparse = modules.load<
        typeof import('../../tasks/use-mobile-tasks-workspace-sparse-actions')
      >(
        'mobile/src/tasks/use-mobile-tasks-workspace-sparse-actions.tsx'
      ).useMobileTasksWorkspaceSparseActions
      const model = observableModel(context, {
        client: context.client,
        tasksSupported: true,
        canSaveWorkspaceSparseDraft: true,
        workspaceCreateDraft: { key: 'linear:1' },
        workspaceCreateTargetConnectionId: 'ssh-1',
        workspaceCreateTargetRepo: { id: REPO, displayName: 'Repo' },
        workspaceSparseCheckoutAvailable: true,
        workspaceSparseDraft: { mode: 'new', name: 'docs', directoriesText: 'docs' },
        workspaceSparseDraftName: 'docs',
        workspaceSparseDraftParsed: { directories: ['docs'] },
        workspaceSparsePresetId: null,
        workspaceSparsePresets: [],
        workspaceSparsePresetsLoaded: false,
        workspaceSparsePresetsLoading: false,
        workspaceSparsePresetsError: '',
        workspaceSparseSaving: false,
        workspaceSshState: null,
        workspaceSshConnecting: false,
        showWorkspaceSparsePicker: false
      })
      let actions: ReturnType<typeof useSparse>
      const hook = hookMount(() => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the recorder supplies only the members the hook reads.
        actions = useSparse(model as unknown as Parameters<typeof useSparse>[0])
      })
      return {
        action(name) {
          if (name === 'mount') {
            return hook.mount()
          }
          if (name === 'unmount') {
            return hook.unmount()
          }
          if (name === 'save-preset') {
            return performHookAction(() => actions.saveWorkspaceSparsePreset())
          }
          throw new Error(`Unknown workspace sparse action: ${name}`)
        },
        state: () =>
          projectObservable({
            presets: model.workspaceSparsePresets,
            presetsError: model.workspaceSparsePresetsError,
            saving: model.workspaceSparseSaving,
            ssh: model.workspaceSshState
          }),
        dispose: hook.unmount
      }
    },
    'tasks.workspace-ssh': (context) => {
      const useSsh = modules.load<
        typeof import('../../tasks/use-mobile-tasks-workspace-ssh-state')
      >('mobile/src/tasks/use-mobile-tasks-workspace-ssh-state.tsx').useMobileTasksWorkspaceSshState
      const repo = { id: REPO, displayName: 'Repo', connectionId: 'ssh-1' }
      const model = observableModel(context, {
        client: context.client,
        tasksSupported: true,
        runtimeTaskSettings: { disabledTuiAgents: [] },
        workspaceAgent: null,
        workspaceAgentOverridden: false,
        workspaceCreateDraft: { key: 'linear:1' },
        workspaceCreateRequiresSshConnection: false,
        workspaceCreateSshStatus: 'connected',
        workspaceCreateTargetConnectionId: 'ssh-1',
        workspaceCreateTargetRepo: repo,
        workspaceDetectedAgentIds: null,
        workspaceSshState: null,
        workspaceSshConnecting: false
      })
      let actions: ReturnType<typeof useSsh>
      const hook = hookMount(() => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the recorder supplies only the members the hook reads.
        actions = useSsh(model as unknown as Parameters<typeof useSsh>[0])
      })
      let setup: unknown = 'unresolved'
      return {
        action(name) {
          if (name === 'mount') {
            return hook.mount()
          }
          if (name === 'unmount') {
            return hook.unmount()
          }
          if (name === 'connect') {
            return performHookAction(() => actions.connectWorkspaceSshRepo())
          }
          if (name === 'ensure-ready') {
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads only id, displayName and connectionId.
            return actions.ensureWorkspaceSshReady(
              repo as Parameters<typeof actions.ensureWorkspaceSshReady>[0]
            )
          }
          if (name === 'resolve-setup') {
            return (
              actions
                // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above.
                .resolveCreateSetupDecision(
                  repo as Parameters<typeof actions.resolveCreateSetupDecision>[0]
                )
                .then((value: unknown) => {
                  setup = value
                  return value
                })
            )
          }
          throw new Error(`Unknown workspace ssh action: ${name}`)
        },
        state: () =>
          projectObservable({
            ssh: model.workspaceSshState,
            connecting: model.workspaceSshConnecting,
            detected: model.workspaceDetectedAgentIds,
            agent: model.workspaceAgent,
            setup
          }),
        dispose: hook.unmount
      }
    }
  }
}
