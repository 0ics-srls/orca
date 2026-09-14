import { MOUNTED_OPERATION_MODULES } from './adapters/mounted-operation-modules'
import { operationModuleLoader, type Mutation } from './operation-module-loader'
import type { MountedOperationModule, MountOptions } from './mounted-operation-module'
import type { MountAdapter } from './recording-scenario'

/**
 * The mount table one recording runs against: every registered domain module, merged. Nothing is
 * mounted here, because an adapter defined in this file would be pinned by `recorderSha256` on
 * every golden rather than by `adapterSha256` on the goldens that mount it.
 */
export function pilotMountAdapters(
  root: string,
  options: MountOptions & { mutation?: Mutation } = {},
  registered: readonly MountedOperationModule[] = MOUNTED_OPERATION_MODULES
) {
  const modules = operationModuleLoader(root, options.mutation)
  const adapters: Record<string, MountAdapter> = {}
  for (const module of registered) {
    for (const [operation, adapter] of Object.entries(module.mounts(modules, options))) {
      if (operation in adapters) {
        throw new Error(`Two adapter modules mount ${operation}`)
      }
      adapters[operation] = adapter
    }
  }
  return { adapters, assertMutationApplied: modules.assertMutationApplied }
}
