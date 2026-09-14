import type { ExecutionHostId } from '../../../shared/execution-host'
import { createBrowserUuid } from './browser-uuid'

export type WorkspaceSurfaceIdentity =
  | { kind: 'tab'; id: string }
  | { kind: 'workspace-content'; id: string }

export type WorkspaceSurfaceProductionResult =
  | { kind: 'materialized'; surface: WorkspaceSurfaceIdentity }
  | { kind: 'declined'; reason: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'unverifiable'; reason: string }

export type WorkspaceSurfaceProducerAttempt = {
  id: string
  workspaceKey: string
  executionHostId: ExecutionHostId
  result: Promise<WorkspaceSurfaceProductionResult>
}

export type WorkspaceSurfaceProducer = {
  attempt: WorkspaceSurfaceProducerAttempt
  materialized: (surface: WorkspaceSurfaceIdentity) => void
  declined: (reason: unknown) => void
  failed: (reason: unknown) => void
  unverifiable: (reason: unknown) => void
}

export type WorkspaceSurfaceProducerEntry = {
  attempt: WorkspaceSurfaceProducerAttempt
  result: WorkspaceSurfaceProductionResult | null
  settle: (result: WorkspaceSurfaceProductionResult) => void
}

const entriesByAttemptId = new Map<string, WorkspaceSurfaceProducerEntry>()
const listeners = new Set<() => void>()

function notifyListeners(): void {
  for (const listener of listeners) {
    listener()
  }
}

function reasonText(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message
  }
  const text = String(reason)
  return text === '[object Object]' ? 'The surface producer did not provide a reason.' : text
}

export function registerWorkspaceSurfaceProducer(args: {
  workspaceKey: string
  executionHostId: ExecutionHostId
  attemptId?: string
}): WorkspaceSurfaceProducer {
  const id = args.attemptId?.trim() || createBrowserUuid()
  if (entriesByAttemptId.has(id)) {
    throw new Error(`A workspace surface producer already owns attempt ${id}.`)
  }
  let settlePromise: (result: WorkspaceSurfaceProductionResult) => void = () => undefined
  const result = new Promise<WorkspaceSurfaceProductionResult>((resolve) => {
    settlePromise = resolve
  })
  const attempt: WorkspaceSurfaceProducerAttempt = {
    id,
    workspaceKey: args.workspaceKey,
    executionHostId: args.executionHostId,
    result
  }
  const entry: WorkspaceSurfaceProducerEntry = {
    attempt,
    result: null,
    settle: (settlement) => {
      if (entry.result) {
        return
      }
      entry.result = settlement
      settlePromise(settlement)
      notifyListeners()
    }
  }
  entriesByAttemptId.set(id, entry)
  notifyListeners()
  return {
    attempt,
    materialized: (surface) => entry.settle({ kind: 'materialized', surface }),
    declined: (reason) => entry.settle({ kind: 'declined', reason: reasonText(reason) }),
    failed: (reason) => entry.settle({ kind: 'failed', reason: reasonText(reason) }),
    unverifiable: (reason) => entry.settle({ kind: 'unverifiable', reason: reasonText(reason) })
  }
}

export function readWorkspaceSurfaceProducerEntries(args: {
  workspaceKey: string
  executionHostId: ExecutionHostId
}): readonly Readonly<WorkspaceSurfaceProducerEntry>[] {
  return [...entriesByAttemptId.values()].filter(
    (entry) =>
      entry.attempt.workspaceKey === args.workspaceKey &&
      entry.attempt.executionHostId === args.executionHostId
  )
}

export function consumeWorkspaceSurfaceProducerAttempt(attemptId: string): void {
  const entry = entriesByAttemptId.get(attemptId)
  if (!entry || entry.result?.kind === 'unverifiable' || entry.result === null) {
    return
  }
  entriesByAttemptId.delete(attemptId)
  notifyListeners()
}

export function subscribeWorkspaceSurfaceProducers(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetWorkspaceSurfaceProducersForTests(): void {
  entriesByAttemptId.clear()
  notifyListeners()
}
