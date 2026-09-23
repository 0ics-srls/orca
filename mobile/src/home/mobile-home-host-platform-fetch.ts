import { recordHostPlatform } from '../transport/host-platform-store'
import { hostStatusProbe, readHostStatusGates } from '../transport/host-status-probe-operations'
import type { RpcClient } from '../transport/rpc-client'

/** Refreshes the host's reported OS once per connection; a failed or unreadable read keeps the record. */
export function fetchMobileHomeHostPlatform(
  client: RpcClient,
  hostId: string,
  disposed: () => boolean
): void {
  hostStatusProbe
    .request(client)
    .then((reply) => {
      const status = readHostStatusGates(reply)
      if (!disposed() && status) {
        recordHostPlatform(hostId, status.hostPlatform ?? null)
      }
    })
    .catch(() => {})
}
