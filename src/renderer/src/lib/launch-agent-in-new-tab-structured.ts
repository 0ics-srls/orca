import type { AgentSessionLaunchPlan } from '@/lib/agent-session-launch-plan'
import type { StructuredAgentLaunchSettlement } from '@/lib/structured-agent-launch-settlement'
import type { StructuredPromptDeliveryResult } from '@/lib/structured-agent-session-launch-prompt'

export type StructuredNewTabLaunchArgs = {
  /** Planned on the structured route with an already-trimmed prompt; empty means no prompt. */
  plan: AgentSessionLaunchPlan
}

export type StructuredNewTabLaunch = {
  structuredSettlement: Promise<StructuredAgentLaunchSettlement>
  promptDeliveryResult?: Promise<StructuredPromptDeliveryResult>
}

const UNDELIVERED: StructuredPromptDeliveryResult = { delivered: false, failureNotified: true }

function promptDeliveryFromSettlement(
  settlement: StructuredAgentLaunchSettlement
): Promise<StructuredPromptDeliveryResult> {
  if (settlement.kind === 'structured') {
    return settlement.promptDeliveryResult ?? Promise.resolve(UNDELIVERED)
  }
  return Promise.resolve(UNDELIVERED)
}

/**
 * The new-tab launcher's structured branch. Returns synchronously so `launchAgentInNewTab` keeps
 * its signature; the settlement carries what the structured launch actually did.
 */
export function launchAgentInStructuredNewTab(
  args: StructuredNewTabLaunchArgs
): StructuredNewTabLaunch {
  const hasPrompt = Boolean(args.plan.prompt)
  const structuredSettlement = args.plan.launch({}).then(
    (settlement): StructuredAgentLaunchSettlement =>
      settlement ?? {
        kind: 'failed',
        error: new Error('Launch planned off the structured route')
      },
    (error: unknown): StructuredAgentLaunchSettlement => ({ kind: 'failed', error })
  )
  void structuredSettlement.then((settlement) => {
    // Why: unknown already shows the launch badge and failed already toasted; this is the log
    // line the old fire-and-forget fallback claim kept.
    if (settlement.kind === 'failed') {
      console.error('Structured agent launch failed', settlement.error)
    }
  })
  return {
    structuredSettlement,
    // Why: draft mode has no delivery event; the composer adopts the text and the user sends it.
    ...(hasPrompt && args.plan.promptDelivery !== 'draft'
      ? { promptDeliveryResult: structuredSettlement.then(promptDeliveryFromSettlement) }
      : {})
  }
}
