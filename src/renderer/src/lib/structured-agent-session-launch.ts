import type { AgentSessionHandleProvider } from '../../../shared/agent-session-provider-handle'
import { structuredAgentLabel } from '@/lib/structured-agent-session-launch-label'
import {
  abandonStructuredAgentSessionLaunchIntent,
  createStructuredAgentSessionLaunchIntent,
  StructuredAgentSessionCreateRefusalError
} from '@/lib/launch-structured-agent-session'
import {
  discardStructuredAgentSessionLaunchOutbox,
  enqueueStructuredAgentSessionLaunchPrompt
} from '@/components/native-chat/structured-agent-session-outbox-storage'
import {
  launchAndReconcile,
  reconcileUnknownLaunch,
  type StructuredAgentLaunchReceipt
} from '@/lib/structured-agent-session-launch-recovery'
import type { StructuredPromptDeliveryResult } from '@/lib/structured-agent-session-launch-prompt'
import {
  addStructuredLaunchCaller,
  createStructuredLaunchCallerGroup,
  releaseStructuredLaunchCallerAfterUnknownOutcome,
  settleStructuredLaunchCallers,
  structuredLaunchCallersHavePendingWork,
  type StructuredAgentLaunchOptions,
  type StructuredLaunchCaller
} from '@/lib/structured-agent-session-launch-callers'
import * as launchDraft from './structured-agent-session-launch-draft'
import { trackStructuredLaunchFailureToast } from './structured-agent-session-launch-failure-toast'
import {
  deleteStructuredLaunchStateIfCurrent,
  getStructuredLaunchState,
  notifyStructuredLaunchListeners,
  setStructuredLaunchState,
  structuredLaunchIdentity,
  structuredLaunchStates,
  type StructuredLaunchState
} from './structured-agent-session-launch-registry'

export type { StructuredAgentLaunchOptions, StructuredAgentLaunchReceipt }
export {
  getStructuredAgentLaunchStatus,
  subscribeStructuredAgentLaunchStatus,
  useStructuredAgentLaunchStatus,
  type StructuredAgentLaunchStatus
} from './structured-agent-session-launch-registry'

type StructuredLaunchStateResult = {
  state: StructuredLaunchState
  caller: StructuredLaunchCaller
}

export type StructuredAgentLaunchResult = {
  sessionId: string
  launchResult: Promise<StructuredAgentLaunchReceipt>
  promptDeliveryResult?: Promise<StructuredPromptDeliveryResult>
  isVisibilityUnknown: () => boolean
  releaseCallerAfterUnknownOutcome: () => boolean
}

/** What the outbox must carry: a draft goes to the composer seed instead. */
function outboxPromptText(options: StructuredAgentLaunchOptions): string {
  return options.promptDelivery === 'draft' ? '' : (options.prompt?.trim() ?? '')
}

function joinLaunchDelivery(
  options: StructuredAgentLaunchOptions,
  established: StructuredAgentLaunchOptions['promptDelivery']
): StructuredAgentLaunchOptions {
  // Why: the first caller's mode wins, but with none established an absent mode reads as submit —
  // that would send a joiner's draft it never consented to send.
  const mode = established ?? options.promptDelivery
  const { promptDelivery: _joinerMode, ...rest } = options
  return mode ? { ...rest, promptDelivery: mode } : rest
}

function cleanupLaunchState(state: StructuredLaunchState): void {
  if (deleteStructuredLaunchStateIfCurrent(state)) {
    notifyStructuredLaunchListeners()
  }
}

function maybeCleanupLaunchState(state: StructuredLaunchState): void {
  if (structuredLaunchCallersHavePendingWork(state.callers)) {
    return
  }
  cleanupLaunchState(state)
}

function settleStructuredLaunchRefusal(state: StructuredLaunchState): void {
  if (state.callers.outcome !== 'pending' && state.callers.outcome !== 'unknown') {
    return
  }
  abandonStructuredAgentSessionLaunchIntent(state.intent)
  discardStructuredAgentSessionLaunchOutbox(state.intent.sessionId)
  launchDraft.clearStructuredAgentLaunchDraft(state.intent.sessionId)
  settleStructuredLaunchCallers(state.callers, 'failed')
  cleanupLaunchState(state)
}

function trackLaunchSettlement(
  state: StructuredLaunchState,
  promise: Promise<StructuredAgentLaunchReceipt>
): void {
  void promise.then(
    () => {
      if (state.promise !== promise) {
        return
      }
      settleStructuredLaunchCallers(state.callers, 'published')
    },
    (error) => {
      if (state.promise !== promise || state.cancelled) {
        return
      }
      if (error instanceof StructuredAgentSessionCreateRefusalError) {
        settleStructuredLaunchRefusal(state)
      } else if (!state.visibilityUnknown) {
        settleStructuredLaunchCallers(state.callers, 'failed')
        // Why: the seed lives under a tab that will never open; unknown keeps it for the retry.
        launchDraft.clearStructuredAgentLaunchDraft(state.intent.sessionId)
        maybeCleanupLaunchState(state)
      } else {
        state.callers.outcome = 'unknown'
        notifyStructuredLaunchListeners()
      }
    }
  )
}

function structuredAgentLaunchState(
  worktreeId: string,
  agent: AgentSessionHandleProvider,
  options: StructuredAgentLaunchOptions
): StructuredLaunchStateResult {
  const identity = structuredLaunchIdentity(worktreeId, agent, options.resumeFrom)
  const existing = getStructuredLaunchState(identity)
  if (existing) {
    if (existing.visibilityUnknown) {
      existing.callers.outcome = 'pending'
      existing.promise = reconcileUnknownLaunch(existing)
      trackLaunchSettlement(existing, existing.promise)
      trackStructuredLaunchFailureToast(existing.intent.agent, existing.promise)
      notifyStructuredLaunchListeners()
    }
    const joined = joinLaunchDelivery(options, existing.promptDelivery)
    const text = outboxPromptText(joined)
    const stagedPrompt = text
      ? enqueueStructuredAgentSessionLaunchPrompt(existing.intent.sessionId, text)
      : null
    launchDraft.seedStructuredAgentLaunchDraft(existing.intent.sessionId, agent, joined)
    return {
      state: existing,
      caller: addStructuredLaunchCaller({
        group: existing.callers,
        launchResult: existing.promise,
        options: joined,
        stagedEntry: stagedPrompt
      })
    }
  }

  // Only pass the third argument when adopting: every ordinary launch keeps the two-argument call
  // it has always made, so this change adds no trailing `undefined` for call-site assertions to
  // absorb.
  const intent = options.resumeFrom
    ? createStructuredAgentSessionLaunchIntent(worktreeId, agent, options.resumeFrom)
    : createStructuredAgentSessionLaunchIntent(worktreeId, agent)
  const text = outboxPromptText(options)
  const stagedPrompt = text
    ? enqueueStructuredAgentSessionLaunchPrompt(intent.sessionId, text)
    : null
  launchDraft.seedStructuredAgentLaunchDraft(intent.sessionId, agent, options)
  const callers = createStructuredLaunchCallerGroup()
  const state: StructuredLaunchState = {
    identity,
    intent,
    promptDelivery: options.promptDelivery,
    promise: Promise.resolve({ sessionId: '', fence: 0 }),
    visibilityUnknown: false,
    cancelled: false,
    onVisibilityChanged: notifyStructuredLaunchListeners,
    callers
  }
  callers.onSettled = () => maybeCleanupLaunchState(state)
  state.promise =
    text && !stagedPrompt
      ? Promise.reject(
          new StructuredAgentSessionCreateRefusalError(
            `Could not durably stage the ${structuredAgentLabel(agent)} launch prompt.`
          )
        )
      : launchAndReconcile(state)
  const caller = addStructuredLaunchCaller({
    group: state.callers,
    launchResult: state.promise,
    options,
    stagedEntry: stagedPrompt
  })
  setStructuredLaunchState(state)
  notifyStructuredLaunchListeners()
  trackLaunchSettlement(state, state.promise)
  trackStructuredLaunchFailureToast(state.intent.agent, state.promise)
  return {
    state,
    caller
  }
}

export function cancelStructuredAgentLaunch(worktreeId: string, sessionId: string): boolean {
  const state = [...structuredLaunchStates()].find(
    (candidate) =>
      candidate.intent.worktreeId === worktreeId && candidate.intent.sessionId === sessionId
  )
  if (!state) {
    return false
  }
  state.cancelled = true
  settleStructuredLaunchCallers(state.callers, 'cancelled')
  cleanupLaunchState(state)
  discardStructuredAgentSessionLaunchOutbox(state.intent.sessionId)
  launchDraft.clearStructuredAgentLaunchDraft(state.intent.sessionId)
  abandonStructuredAgentSessionLaunchIntent(state.intent)
  notifyStructuredLaunchListeners()
  return true
}

export function startStructuredAgentLaunch(
  worktreeId: string,
  agent: AgentSessionHandleProvider,
  options: StructuredAgentLaunchOptions = {}
): StructuredAgentLaunchResult {
  const { state, caller } = structuredAgentLaunchState(worktreeId, agent, options)
  return {
    sessionId: state.intent.sessionId,
    launchResult: state.promise,
    ...(caller.promptDeliveryResult ? { promptDeliveryResult: caller.promptDeliveryResult } : {}),
    isVisibilityUnknown: () => state.visibilityUnknown,
    releaseCallerAfterUnknownOutcome: () =>
      releaseStructuredLaunchCallerAfterUnknownOutcome(state.callers, caller)
  }
}
