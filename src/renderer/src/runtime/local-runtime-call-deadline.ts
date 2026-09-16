import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'

/**
 * Runs a desktop (local) runtime RPC, honouring a deadline the caller asked for. The remote branch
 * has always forwarded `timeoutMs`; this is the same contract for the local one.
 *
 * Only an explicitly requested `timeoutMs` is applied. There is deliberately no default: a blanket
 * local deadline would reach `agentSession.send`, whose transport-shaped failures are classified as
 * delivery-unknown, and elapsed time is not evidence that a message was not delivered.
 *
 * A deadline bounds the caller, never the host. A caller that must know whether the work actually
 * finished has to resolve that against the host's own completion signal, not against this promise.
 */
export function callLocalRuntimeWithDeadline(
  method: string,
  params: unknown,
  timeoutMs: number | undefined
): Promise<RuntimeRpcResponse<unknown>> {
  const call = window.api.runtime.call({ method, params })
  if (timeoutMs === undefined) {
    // Why: hand back the transport's own promise. Wrapping it in an async frame would insert a
    // microtask, reordering calls that callers sequence against each other.
    return call
  }
  let deadline: ReturnType<typeof setTimeout> | undefined
  const bounded = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(
      () => reject(new Error(`Runtime request timed out before ${method} completed`)),
      timeoutMs
    )
  })
  return Promise.race([call, bounded]).finally(() => clearTimeout(deadline))
}
