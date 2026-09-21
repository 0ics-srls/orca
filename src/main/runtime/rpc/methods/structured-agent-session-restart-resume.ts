// `agentSession.restartResumable` / `agentSession.restartResume` — the restart-resume offer.
//
// Both reach for records on disk this process may not have opened yet, so they build the host the
// way hold and reveal do. Listing is read-only and takes nothing live; resuming goes through the
// host's single resume path, which re-derives eligibility rather than trusting the ids it is given.

import { defineMethod } from '../core'
import {
  ensureStructuredHostInstalled,
  requireStructuredHost,
  structuredCallerFor
} from './structured-agent-session-gate'
import { RestartResumableParams, RestartResumeParams } from './structured-agent-session-schemas'

export const STRUCTURED_AGENT_SESSION_RESTART_RESUME_METHODS = [
  defineMethod({
    name: 'agentSession.restartResumable',
    params: RestartResumableParams,
    handler: async (_params, ctx) => {
      await ensureStructuredHostInstalled(ctx)
      return { sessions: await requireStructuredHost(ctx).restartResume.list() }
    }
  }),
  defineMethod({
    // Explicitly abandons the markers without resuming. Closing the dialog is a snooze and does
    // not call this method, so the status-bar entry can reopen the offer later.
    name: 'agentSession.restartResumableDismiss',
    params: RestartResumableParams,
    handler: async (_params, ctx) => {
      await ensureStructuredHostInstalled(ctx)
      return { dismissed: await requireStructuredHost(ctx).restartResume.dismiss() }
    }
  }),
  defineMethod({
    // Reattach AND ask each reattached agent to carry on — what the desktop prompt now calls
    // resuming, and what an opted-in launch runs without asking. Still a separate method from
    // `restartResume`, which sends nothing, but no longer one that only a button can reach.
    name: 'agentSession.restartContinue',
    params: RestartResumeParams,
    handler: async (params, ctx) => {
      await ensureStructuredHostInstalled(ctx)
      const host = requireStructuredHost(ctx)
      return host.restartResume.continueAfterRestart(
        params.sessionIds,
        structuredCallerFor(ctx).callerKey
      )
    }
  }),
  defineMethod({
    // Reattach only, no send. The desktop prompt stopped calling this once its single action became
    // resume-and-continue, but it stays: it is a published wire method, and its absence is what an
    // older or non-desktop client would be met with.
    name: 'agentSession.restartResume',
    params: RestartResumeParams,
    handler: async (params, ctx) => {
      await ensureStructuredHostInstalled(ctx)
      const host = requireStructuredHost(ctx)
      return {
        results: await host.restartResume.resume(
          params.sessionIds,
          structuredCallerFor(ctx).callerKey
        )
      }
    }
  })
]
