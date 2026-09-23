// What became of the offers an action spent, kept for the surfaces that must still name them.
//
// The toast that reports a chat Orca could not carry on is gone in seconds and the reattach spends
// the offer, so without this record nothing durable would point at the chat the user has to
// continue by hand. The capsule holds the record; this decides what goes in and when it leaves.

import type {
  AgentSessionRecoveryCapsule,
  AgentSessionResumeFailureInput,
  AgentSessionResumeFailureRecord
} from '../../runtime/agent-session-recovery-capsule'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionResumeFailureOutcome } from '../../../shared/agent-session-resume-marker'
import { normalizeOptionalField } from '../../../shared/agent-status-field-normalization'
import { AGENT_MODEL_MAX_LENGTH } from '../../../shared/agent-status-types'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { adapterSupportsRecord } from './structured-agent-session-provider-support'
import type { StructuredAgentSessionContinuationOutcome } from './structured-agent-session-restart-continuation'
import type {
  StructuredAgentSessionResumeCandidate,
  StructuredAgentSessionResumeFailure
} from './structured-agent-session-restart-resume-set'
import type { StructuredAgentSessionResumeOutcome } from './structured-agent-session-restart-resume-runner'
import { STRUCTURED_AGENT_SESSION_RESTART_CONTINUATION_CALLER } from './structured-agent-session-restart-resume-wiring'

type FailureCapsule = Pick<
  AgentSessionRecoveryCapsule,
  'listFailed' | 'completeResume' | 'failResume' | 'rollbackResume' | 'dismiss' | 'clearAll'
>

export type StructuredAgentSessionRestartFailureLedger = {
  /** The raw records, refreshing which sessions are known to have failed. */
  read: () => Promise<AgentSessionResumeFailureRecord[]>
  /** The records as rows a surface can show; sessions this host no longer holds are left out. */
  list: () => Promise<StructuredAgentSessionResumeFailure[]>
  /** Settles one operation's reservations: the agent carried on, or the failure is filed. Rows the
   *  operation still owns after that are reopened. */
  settle: (
    operationId: string,
    outcomes: readonly StructuredAgentSessionResumeOutcome[],
    action: {
      candidates: readonly StructuredAgentSessionResumeCandidate[]
      /** How a reattached session's action ended; null when the agent carried on. Reattaching alone
       *  is not the whole action, so the runner's own outcome cannot decide this. */
      failureAfterResume: (sessionId: string) => AgentSessionResumeFailureOutcome | null
      failureReason: (sessionId: string) => string
    }
  ) => Promise<void>
  /** Named sessions forget their offer or failure; unnamed, every durable record goes. */
  dismiss: (
    sessionIds: readonly string[] | undefined,
    beforeClearAll: () => void
  ) => Promise<number>
  /** The user's own send in that chat is the manual continuation a failure asked for. Bookkeeping
   *  behind the send: reported, never awaited by it. */
  releaseOnUserSend: (
    caller: { callerKey: string },
    params: { envelope: { sessionId: string } }
  ) => void
}

/** Which continuation outcomes count as the agent not carrying on, and how each is filed. */
export function continuationFailureOutcome(
  outcome: StructuredAgentSessionContinuationOutcome['outcome']
): AgentSessionResumeFailureOutcome | null {
  return outcome === 'continued' ? null : outcome === 'refused' ? 'refused' : 'unconfirmed'
}

export function createStructuredAgentSessionRestartFailureLedger(deps: {
  capsule?: FailureCapsule
  getRecord: (sessionId: string) => AgentSessionRecord | null
  adapter: StructuredAgentSessionAdapter
  now: () => number
  /** The capsule's single mutation lane, shared with the offer's own operations. */
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>
}): StructuredAgentSessionRestartFailureLedger {
  /** Session ids with a recorded failure, as of the last read or write. Lets a user send skip the
   *  file entirely in the common case where nothing failed. */
  const known = new Set<string>()

  const read = async (): Promise<AgentSessionResumeFailureRecord[]> => {
    try {
      const failures = (await deps.capsule?.listFailed(deps.now())) ?? []
      known.clear()
      for (const failure of failures) {
        known.add(failure.marker.sessionId)
      }
      return failures
    } catch {
      // Recovery is advisory; a malformed capsule must not make ordinary chat actions unusable.
      console.warn('[structured-agent-session] reading recovery capsule failed')
      return []
    }
  }

  const list = async (): Promise<StructuredAgentSessionResumeFailure[]> =>
    (await read()).flatMap((failure) => {
      const record = deps.getRecord(failure.marker.sessionId)
      if (!record || !adapterSupportsRecord(deps.adapter, record)) {
        return []
      }
      const model = normalizeOptionalField(record.options?.model, AGENT_MODEL_MAX_LENGTH)
      return [
        {
          sessionId: failure.marker.sessionId,
          workspaceId: record.location.workspaceId,
          agent: record.provider,
          work: failure.marker.work,
          trigger: failure.marker.trigger,
          recordedAt: failure.marker.recordedAt,
          latestPrompt: failure.latestPrompt,
          executionHostId: record.location.executionHostId,
          workspaceKind: record.location.workspaceKind,
          ...(model === undefined ? {} : { model }),
          failedAt: failure.failedAt,
          outcome: failure.outcome,
          reason: failure.reason
        }
      ]
    })

  const settle: StructuredAgentSessionRestartFailureLedger['settle'] = async (
    operationId,
    outcomes,
    action
  ) => {
    const capsule = deps.capsule
    if (!capsule) {
      return
    }
    const completed: string[] = []
    const failures: AgentSessionResumeFailureInput[] = []
    const promptBySession = new Map(
      action.candidates.map((candidate) => [candidate.sessionId, candidate.latestPrompt])
    )
    for (const outcome of outcomes) {
      const resumed = outcome.outcome === 'resumed'
      const failure = resumed ? action.failureAfterResume(outcome.sessionId) : 'refused'
      if (failure === null) {
        completed.push(outcome.sessionId)
        continue
      }
      failures.push({
        sessionId: outcome.sessionId,
        failedAt: deps.now(),
        outcome: failure,
        reason: resumed
          ? action.failureReason(outcome.sessionId)
          : (outcome.reason ?? 'agent_session_resume_refused'),
        latestPrompt: promptBySession.get(outcome.sessionId) ?? ''
      })
    }
    await deps
      .enqueue(() => capsule.completeResume(operationId, completed, deps.now()))
      .catch(() => {
        console.warn('[structured-agent-session] restart offer completion failed')
      })
    // Filed before the rollback so a failure the user must act on is never reopened as an offer
    // that would silently re-run it.
    await deps
      .enqueue(() => capsule.failResume(operationId, failures, deps.now()))
      .catch(() => {
        console.warn('[structured-agent-session] restart failure record failed')
      })
    for (const failure of failures) {
      known.add(failure.sessionId)
    }
    // This only reopens rows still owned by this operation. Rows removed by completeResume stay
    // removed, even when the write of a later bookkeeping step fails.
    await deps
      .enqueue(() => capsule.rollbackResume(operationId, deps.now()))
      .catch(() => {
        console.warn('[structured-agent-session] restart offer rollback failed')
      })
  }

  return {
    read,
    list,
    settle,
    dismiss: (sessionIds, beforeClearAll) =>
      deps.enqueue(async () => {
        if (sessionIds !== undefined) {
          for (const sessionId of sessionIds) {
            known.delete(sessionId)
          }
          return (await deps.capsule?.dismiss(sessionIds, deps.now())) ?? 0
        }
        beforeClearAll()
        known.clear()
        return (await deps.capsule?.clearAll(deps.now())) ?? 0
      }),
    releaseOnUserSend: (caller, params) => {
      const sessionId = params.envelope.sessionId
      if (
        caller.callerKey === STRUCTURED_AGENT_SESSION_RESTART_CONTINUATION_CALLER ||
        !known.has(sessionId)
      ) {
        return
      }
      known.delete(sessionId)
      void deps
        .enqueue(() => deps.capsule?.dismiss([sessionId], deps.now()) ?? Promise.resolve(0))
        .catch(() => {
          console.warn('[structured-agent-session] restart failure release failed')
        })
    }
  }
}
