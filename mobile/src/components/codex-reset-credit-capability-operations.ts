import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'
import { rpcReadUnchecked } from '../transport/rpc-reader-payload'

// Reads the capability list off a status the object policy already admitted, so a non-object
// result reads as no capabilities rather than throwing — which is what the probe's `catch` did.
const capabilityListReader: RpcCompatibleReader<
  Record<string, unknown>,
  'capabilities',
  unknown
> = (raw) => rpcReadUnchecked('capabilities', raw.capabilities)

/**
 * status.get read for the Codex reset-credit probe, the fourth policy on this method.
 *
 * `object-result-or-null` is the only one that matches: the probe treats a refusal, a null result
 * and a non-object result identically as "unsupported", where the tasks and files families throw
 * or skip. It is the policy `rpcObjectResultOrNull` already spelled at this call site.
 */
export const codexResetCreditCapabilityRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'status.codex-reset-credit-capability',
    method: 'status.get',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: capabilityListReader
  })
)

/** What the probe sends with, named from an operation so no module names the raw port. */
export type MobileCodexResetCapabilityRpcSender = Parameters<
  typeof codexResetCreditCapabilityRead.request
>[0]
