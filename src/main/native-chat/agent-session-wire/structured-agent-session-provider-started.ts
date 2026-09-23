// The host's half of a provider child proving its start.
//
// A publish-first acquire hands the host a child that has answered nothing yet, so the record
// keeps only the saved options the reservation carried. This is where the host learns the start
// landed, flips the session to `ready`, and persists what the child now reports as fact through
// the same record write a user's option change takes. Bookkeeping never gates the user: a failed
// write is reported and the session stays usable.

import { agentSessionLeaseAdmitsWriter } from '../../../shared/agent-session-lease-adjudication'
import type { StructuredAgentSessionStartedEvent } from './structured-agent-session-adapter'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from './structured-agent-session-host-types'
import { readNativeSessionOptions } from './structured-agent-session-option-restoration'

export type StructuredAgentSessionProviderStartedContext = {
  deps: StructuredAgentSessionHostDeps
  sessions: Map<string, StructuredAgentSessionHostSession>
  serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
  now: () => number
  publishStatus?: (sessionId: string) => void
  onBarrierError: (sessionId: string, error: unknown) => void
}

export function settleStructuredAgentSessionProviderStarted(
  context: StructuredAgentSessionProviderStartedContext,
  event: StructuredAgentSessionStartedEvent
): Promise<void> {
  // Serialized behind the attach that published this child, so the lease it proved is committed.
  return context.serialize(event.sessionId, async () => {
    const session = context.sessions.get(event.sessionId)
    if (
      !session?.hasProviderChild ||
      session.fence !== event.fence ||
      session.acquisitionGeneration !== event.acquisitionGeneration
    ) {
      return
    }
    session.providerChildPhase = 'ready'
    try {
      await persistStartedOptions(context, event)
    } catch (error) {
      context.onBarrierError(event.sessionId, error)
    } finally {
      context.publishStatus?.(event.sessionId)
    }
  })
}

async function persistStartedOptions(
  context: StructuredAgentSessionProviderStartedContext,
  event: StructuredAgentSessionStartedEvent
): Promise<void> {
  const { store, adapter } = context.deps
  const record = store.getRecord(event.sessionId)
  if (
    !record ||
    record.lease.runtimeFence !== event.fence ||
    !agentSessionLeaseAdmitsWriter(record.lease)
  ) {
    return
  }
  const options = await readNativeSessionOptions({
    adapter,
    sessionId: event.sessionId,
    fence: event.fence,
    ...(record.options ? { priorOptions: record.options } : {})
  })
  if (options) {
    await store.replaceSessionOptions({
      sessionId: event.sessionId,
      fence: event.fence,
      options,
      now: context.now()
    })
  }
}
