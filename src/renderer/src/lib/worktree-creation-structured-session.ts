import { useAppStore } from '@/store'
import { activateAndRevealWorktree, type ActivateAndRevealResult } from '@/lib/worktree-activation'
import { isAgentSessionHandleProvider } from '../../../shared/agent-session-provider-handle'
import { adoptAgentSessionLaunchVerdict } from '@/lib/agent-session-launch-plan'
import type { AgentLaunchRoute } from '@/lib/agent-launch-routing'
import { activateStructuredAgentSessionById } from '@/lib/structured-agent-session-tab-activation'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import { closeStructuredAgentSession } from '@/runtime/structured-agent-session-close'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'

export type WorktreeCreationStructuredSessionResult = {
  accepted: boolean
  cancelled: boolean
  visibilityUnknown: boolean
  activation: ActivateAndRevealResult | false
  primaryTabId: string | null
}

type LaunchStructuredWorktreeSessionArgs = {
  creationId: string
  request: WorktreeCreationRequest
  /** Required: a non-structured route opens no session here, so the caller must have gated on it. */
  agentLaunchRoute: AgentLaunchRoute
  worktreeId: string
  shouldActivateOnCompletion: boolean
  activation: ActivateAndRevealResult | false
  primaryTabId: string | null
  recoverUnknownLaunch?: boolean
}

async function retireCancelledStructuredSession(
  worktreeId: string,
  sessionId: string
): Promise<void> {
  const target = { kind: 'local' } as const
  await closeStructuredAgentSession(target, sessionId).catch(() => undefined)
  await callRuntimeRpc(target, 'session.tabs.close', {
    worktree: toRuntimeWorktreeSelector(worktreeId),
    tabId: `agent-session:${sessionId}`,
    reason: 'user'
  }).catch(() => undefined)
}

export async function launchStructuredWorktreeSession(
  args: LaunchStructuredWorktreeSessionArgs
): Promise<WorktreeCreationStructuredSessionResult> {
  let { activation, primaryTabId } = args
  const settled = { accepted: true, cancelled: false, visibilityUnknown: false }
  const { agent } = args.request
  if (!isAgentSessionHandleProvider(agent)) {
    return { ...settled, activation, primaryTabId }
  }
  const isCancelled = (): boolean =>
    !useAppStore.getState().pendingWorktreeCreations[args.creationId]
  if (isCancelled()) {
    return { ...settled, cancelled: true, activation, primaryTabId }
  }
  // Why: the composer decided route and delivery mode before the worktree existed, and the request
  // carries that verdict in renderer memory for the life of the create; re-entering with it is what
  // keeps a retry from re-resolving against a host that has changed since.
  const plan = adoptAgentSessionLaunchVerdict({
    route: args.agentLaunchRoute,
    agent,
    ...(args.recoverUnknownLaunch
      ? {}
      : {
          prompt: args.request.launchDraftPrompt ?? args.request.quickPrompt,
          ...(args.request.promptDelivery ? { promptDelivery: args.request.promptDelivery } : {})
        })
  })
  const abandoned = new AbortController()
  const unsubscribe = useAppStore.subscribe((state) => {
    if (!state.pendingWorktreeCreations[args.creationId]) {
      abandoned.abort()
    }
  })
  let settlement: Awaited<ReturnType<typeof plan.launch>>
  try {
    useAppStore.getState().updatePendingWorktreeCreation(args.creationId, {
      phase: 'starting-chat'
    })
    settlement = await plan.launch(
      {
        signal: abandoned.signal,
        onStructuredReady: (sessionId) => {
          if (!args.shouldActivateOnCompletion) {
            return
          }
          // Why: chat selection requires its workspace to be active.
          if (!activation) {
            activation = activateAndRevealWorktree(args.worktreeId, {
              providesInitialSurface: true
            })
            primaryTabId = activation === false ? null : activation.primaryTabId
          }
          activateStructuredAgentSessionById({ worktreeId: args.worktreeId, sessionId })
        }
      },
      { worktreeId: args.worktreeId }
    )
  } catch {
    // Why: nothing awaits this creation's caller, so an escaped throw would strand the panel
    // mid-create. Report it the way a failed launch already does; the launch layer toasts it.
    return { ...settled, activation, primaryTabId }
  } finally {
    unsubscribe()
  }
  if (!settlement) {
    return { ...settled, activation, primaryTabId }
  }
  switch (settlement.kind) {
    case 'cancelled': {
      await retireCancelledStructuredSession(args.worktreeId, settlement.sessionId)
      return {
        ...settled,
        cancelled: true,
        activation,
        primaryTabId
      }
    }
    case 'visibility-unknown':
      return { ...settled, visibilityUnknown: true, activation, primaryTabId }
    case 'structured':
    case 'failed':
      // Why: a failed launch has always reported as accepted here; the launch layer toasts it.
      return { ...settled, activation, primaryTabId }
  }
}
