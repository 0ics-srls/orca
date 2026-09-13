import type { AgentSessionHandleProvider } from '../../../shared/agent-session-provider-handle'
import { StructuredAgentSessionCreateRefusalError } from '@/lib/launch-structured-agent-session'
import {
  cancelStructuredAgentLaunch,
  startStructuredAgentLaunch,
  type StructuredAgentLaunchOptions
} from '@/lib/structured-agent-session-launch'
import type { StructuredPromptDeliveryResult } from '@/lib/structured-agent-session-launch-prompt'
import type { ActivateAndRevealResult } from '@/lib/worktree-activation'

export type StructuredAgentLegacyFallbackResult = {
  /** Absent when the fallback opened a tab in an already-active workspace instead of activating one. */
  activation?: ActivateAndRevealResult | false
  primaryTabId: string | null
  promptDeliveryResult?: Promise<StructuredPromptDeliveryResult>
}

export type StructuredAgentLaunchSettlement =
  | {
      kind: 'structured'
      sessionId: string
      promptDeliveryResult?: Promise<StructuredPromptDeliveryResult>
    }
  | ({ kind: 'refused-then-legacy' } & StructuredAgentLegacyFallbackResult)
  | ({ kind: 'deadline-then-legacy' } & StructuredAgentLegacyFallbackResult)
  | {
      kind: 'cancelled'
      sessionId: string
      /** The legacy surface the refusal fallback had already opened when the cancel arrived; it
       *  outlives the cancel, so the caller must report its tab rather than the pre-launch one. */
      fallback?: StructuredAgentLegacyFallbackResult
    }
  | { kind: 'visibility-unknown'; sessionId: string }
  | { kind: 'failed'; error: unknown }

// Why: the healthy rig opens its tab in ~1.5s; 30s leaves room above the provider's 15s auth-settle
// and 10s init bounds while still giving a stalled launch a bounded, usable fallback.
export const STRUCTURED_AGENT_LAUNCH_DEADLINE_MS = 30_000

export type StructuredAgentLaunchDeadlineClock = {
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type StructuredAgentLaunchHooks = {
  /** What this flow did before structured chat existed: activate with a startup payload, set the
   *  first-message rename flag, run trust preflight. Runs at most once after refusal or deadline.
   *  Resume has no legacy equivalent, so a refusal without this hook settles as `failed`. */
  legacyFallback?: () => Promise<StructuredAgentLegacyFallbackResult>
  onStructuredReady?: (sessionId: string) => void
  /** Removes a structured tab that was published after the deadline fallback won the surface. */
  onStructuredLate?: (sessionId: string) => void
  /** Abort the moment the caller abandons the launch. The loop cancels on the event, not only by
   *  polling after awaits, so a staged prompt is discarded before it can reach the provider. */
  signal?: AbortSignal
  deadlineMs?: number
  clock?: StructuredAgentLaunchDeadlineClock
}

/**
 * The one start / claim-fallback / await / branch loop every structured entrypoint shares.
 * Callers decide the route before calling and consume the settlement; they never touch the launch
 * handle themselves.
 */
export async function settleStructuredAgentLaunch(
  worktreeId: string,
  agent: AgentSessionHandleProvider,
  options: StructuredAgentLaunchOptions,
  hooks: StructuredAgentLaunchHooks
): Promise<StructuredAgentLaunchSettlement> {
  const launch = startStructuredAgentLaunch(worktreeId, agent, options)
  const signal = hooks.signal
  let cancelRequested = false
  const isCancelled = (): boolean => cancelRequested || signal?.aborted === true
  const cancelLaunch = (): void => {
    if (cancelRequested) {
      return
    }
    cancelRequested = true
    cancelStructuredAgentLaunch(worktreeId, launch.sessionId)
  }
  signal?.addEventListener('abort', cancelLaunch, { once: true })
  // Why: the caller may have been abandoned between its own check and this subscription.
  if (isCancelled()) {
    cancelLaunch()
  }
  // Why: a holder, not a `let`: TS narrows a closure-assigned local to its initial null.
  const fallback: { result: StructuredAgentLegacyFallbackResult | null } = { result: null }
  const legacyFallback = hooks.legacyFallback
  const claimFallback = launch.claimFallback ?? launch.claimDefinitiveRefusalFallback
  // Why: the claim resolves after the callback settles, so awaiting it below is what serialises
  // "refused" and "the legacy surface is up". The callback returns nothing so that wait ends at
  // activation, not at the end of a legacy paste that may be minutes away. Without a hook there is
  // nothing to claim: a claimed no-op reads to the launch layer as "a terminal was attempted".
  const refusalFallback = legacyFallback
    ? claimFallback(async () => {
        if (isCancelled()) {
          return
        }
        fallback.result = await legacyFallback()
      })
    : null
  const cancelled = (): StructuredAgentLaunchSettlement => ({
    kind: 'cancelled',
    sessionId: launch.sessionId,
    ...(fallback.result ? { fallback: fallback.result } : {})
  })
  const clock = hooks.clock ?? {
    setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
  let deadlineHandle: unknown
  const deadline = new Promise<'deadline'>((resolve) => {
    deadlineHandle = clock.setTimeout(
      () => resolve('deadline'),
      hooks.deadlineMs ?? STRUCTURED_AGENT_LAUNCH_DEADLINE_MS
    )
  })
  try {
    const result = await Promise.race([
      launch.launchResult.then((receipt) => ({ kind: 'receipt' as const, receipt })),
      deadline.then((kind) => ({ kind }))
    ])
    if (result.kind === 'deadline') {
      if (isCancelled()) {
        return cancelled()
      }
      if (!legacyFallback) {
        if (launch.isVisibilityUnknown()) {
          launch.releaseCallerAfterUnknownOutcome()
        }
        return { kind: 'visibility-unknown', sessionId: launch.sessionId }
      }
      const ran = await claimFallback(async () => {
        if (isCancelled()) {
          return
        }
        fallback.result = await legacyFallback()
      }, 'deadline')
      if (isCancelled()) {
        return cancelled()
      }
      if (ran && fallback.result) {
        void launch.launchResult.then(
          (receipt) => hooks.onStructuredLate?.(receipt.sessionId),
          () => undefined
        )
      }
      return ran && fallback.result
        ? { kind: 'deadline-then-legacy', ...fallback.result }
        : { kind: 'visibility-unknown', sessionId: launch.sessionId }
    }
    const receipt = result.receipt
    if (isCancelled()) {
      return cancelled()
    }
    hooks.onStructuredReady?.(receipt.sessionId)
    return {
      kind: 'structured',
      sessionId: receipt.sessionId,
      ...(launch.promptDeliveryResult ? { promptDeliveryResult: launch.promptDeliveryResult } : {})
    }
  } catch (error) {
    if (isCancelled()) {
      return cancelled()
    }
    if (error instanceof StructuredAgentSessionCreateRefusalError) {
      if (!refusalFallback) {
        return { kind: 'failed', error }
      }
      const ran = await refusalFallback.then(
        (value) => value,
        (fallbackError: unknown) => ({ fallbackError })
      )
      if (isCancelled()) {
        return cancelled()
      }
      if (typeof ran !== 'boolean') {
        return { kind: 'failed', error: ran.fallbackError }
      }
      return ran && fallback.result
        ? { kind: 'refused-then-legacy', ...fallback.result }
        : { kind: 'failed', error }
    }
    if (launch.isVisibilityUnknown()) {
      // Why: nobody awaits this caller once it returns, so a stale fallback closure must not fire
      // if a later retry on the same identity reconciles into a refusal. The launch state itself
      // stays pending so the badge shows "unknown" and the next click still reconciles.
      launch.releaseCallerAfterUnknownOutcome()
      return { kind: 'visibility-unknown', sessionId: launch.sessionId }
    }
    return { kind: 'failed', error }
  } finally {
    if (deadlineHandle !== undefined) {
      clock.clearTimeout(deadlineHandle)
    }
    signal?.removeEventListener('abort', cancelLaunch)
  }
}
