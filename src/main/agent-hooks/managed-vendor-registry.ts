import { auggieHookService } from '../auggie/hook-service'

/** Vendor integrations whose settings schema is not the legacy telemetry enum. */
export type ManagedVendorId = 'auggie'
export type ManagedVendorIntegration = {
  readonly vendor: ManagedVendorId
  readonly install: () => ReturnType<typeof auggieHookService.install>
  readonly remove: () => ReturnType<typeof auggieHookService.remove>
  readonly getStatus: () => ReturnType<typeof auggieHookService.getStatus>
  readonly installRemote: typeof auggieHookService.installRemote
}

// Keep this projection separate from MANAGED_AGENT_INTEGRATIONS: the latter is
// a telemetry/wire enum and cannot grow without a mixed-version protocol bump.
export const MANAGED_VENDOR_INTEGRATIONS: readonly ManagedVendorIntegration[] = [
  {
    vendor: 'auggie',
    install: () => auggieHookService.install(),
    remove: () => auggieHookService.remove(),
    getStatus: () => auggieHookService.getStatus(),
    installRemote: (sftp, remoteHome) => auggieHookService.installRemote(sftp, remoteHome)
  }
]
