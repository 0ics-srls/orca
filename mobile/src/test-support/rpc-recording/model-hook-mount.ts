import { hookMount, performHookAction } from './hook-mount'
import { observableModel, projectObservable } from './observable-model'
import type { MountContext, MountedOperation } from './recording-scenario'

/** What a scenario action may reach: the current actions object, the model, and a re-render. */
export type ModelHookActionContext<Actions> = {
  /** A getter, not a value: an action that re-renders first needs the rebuilt callbacks. */
  readonly actions: () => Actions
  readonly model: Record<string, unknown>
  readonly update: () => void
}

/**
 * The shape the task screen's hooks share: one model in, an actions object out, every setter an
 * effect. Written once because the provider halves of src/tasks/ mount twenty-odd hooks this way
 * and a per-adapter copy of the mount/dispatch/project boilerplate hid the fixture differences
 * that actually matter.
 */
export type ModelHookSpec<Actions> = {
  /** Called inside the render body, so a hook that throws is recorded as a mount failure. */
  readonly useHook: (model: never) => Actions
  readonly fixture: Record<string, unknown>
  readonly actions: (
    context: ModelHookActionContext<Actions>
  ) => Record<string, (args: Record<string, unknown>) => unknown>
  readonly state: (model: Record<string, unknown>) => Record<string, unknown>
}

export function mountModelHook<Actions>(
  context: MountContext,
  spec: ModelHookSpec<Actions>
): MountedOperation {
  const model = observableModel(context, { client: context.client, ...spec.fixture })
  let actions!: Actions
  const hook = hookMount(() => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the recorder supplies only the members the hook reads.
    actions = spec.useHook(model as unknown as never)
  })
  return {
    action(name, args) {
      if (name === 'mount') {
        return hook.mount()
      }
      if (name === 'update') {
        return hook.update()
      }
      const step = spec.actions({
        actions: () => actions,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the proxy is the fixture record the spec declared.
        model: model as unknown as Record<string, unknown>,
        update: hook.update
      })[name]
      if (!step) {
        throw new Error(`Unknown action: ${name}`)
      }
      return performHookAction(() => step(args))
    },
    state: () => projectObservable(spec.state(model)),
    dispose: hook.unmount
  }
}
