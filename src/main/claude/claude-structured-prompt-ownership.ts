import {
  AgentSessionPromptUnavailableError,
  type StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { StructuredSessionCompaction } from '../native-chat/agent-session-wire/structured-session-compaction'
import { CLAUDE_DEFAULT_REQUEST_TIMEOUT_MS } from './claude-agent-sdk-control-requests'
import {
  answerClaudePrompt,
  cancelClaudeTurn,
  supportsClaudeQueuedInterruptCancellation
} from './claude-structured-control-actions'
import {
  claudeHasUnsettledDispatch,
  type ClaudeLateDispatchSettlement
} from './claude-structured-dispatch'
import type { ClaudeSession } from './claude-structured-session-state'

type CancelInput = Parameters<StructuredAgentSessionAdapter['cancelTurn']>[0]
type AnswerInput = Parameters<StructuredAgentSessionAdapter['answerPrompt']>[0]

export function admitClaudePromptCancellation(session: ClaudeSession, promptKey: string): boolean {
  const admission = session.translator?.journalPrompts.cancel(promptKey)
  return admission?.accepted ?? true
}

function waitForClaudePromptCancellation(
  observed: Promise<void>,
  timeoutMs = CLAUDE_DEFAULT_REQUEST_TIMEOUT_MS
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Claude prompt cancellation abort was not observed')),
      timeoutMs
    )
    timer.unref?.()
  })
  return Promise.race([observed, deadline]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

function requireSession(sessions: Map<string, ClaudeSession>, sessionId: string): ClaudeSession {
  const session = sessions.get(sessionId)
  if (!session) {
    throw new Error(`no live claude stream-json session for ${sessionId}`)
  }
  return session
}

export async function cancelClaudeStructuredTurn(input: {
  request: CancelInput
  sessions: Map<string, ClaudeSession>
  compactions: StructuredSessionCompaction
  timeoutMs?: number
  admitPromptCancellation: (session: ClaudeSession, promptKey: string) => boolean
  onDispatchSettledLate?: ClaudeLateDispatchSettlement
}): Promise<{ cancelled: boolean }> {
  const { request, sessions, compactions, timeoutMs } = input
  const session = requireSession(sessions, request.sessionId)
  const acquisitionGeneration = session.acquisitionGeneration
  const prompt = request.prompt
  if (prompt && session.fence !== request.fence) {
    return { cancelled: false }
  }
  const claim = prompt ? session.prompts.claimBound(prompt.itemId, request.turnId) : null
  if (prompt && !claim) {
    return { cancelled: false }
  }
  const cancellationObserved = claim ? session.prompts.observeCancellation(claim) : null
  if (claim && !cancellationObserved) {
    session.prompts.releaseClaim(claim)
    return { cancelled: false }
  }
  // The translator owns turn identity. A session with no journal has published no
  // turn row for a client to name, so it holds no identity this request can contradict.
  const ownsRequestedTurn = (): boolean => {
    const translator = session.translator
    if (!translator) {
      return session.dispatchSequence === 0
    }
    const currentTurnId = translator.currentTurnId
    return currentTurnId === null
      ? session.dispatchSequence === 0
      : currentTurnId === request.turnId
  }
  const isCurrent = (): boolean =>
    sessions.get(request.sessionId) === session &&
    session.fence === request.fence &&
    session.acquisitionGeneration === acquisitionGeneration &&
    (claim && prompt
      ? ownsRequestedTurn() &&
        session.prompts.ownsBoundClaim(claim, prompt.itemId, request.turnId) &&
        (!claudeHasUnsettledDispatch(session) || supportsClaudeQueuedInterruptCancellation(session))
      : compactions.ownsTurn(request.sessionId, request.turnId) ||
        (ownsRequestedTurn() && !claudeHasUnsettledDispatch(session)))
  let interruptConfirmed = false
  try {
    const result = await cancelClaudeTurn(
      session,
      timeoutMs,
      isCurrent,
      input.onDispatchSettledLate
    )
    if (result.cancelled && claim && cancellationObserved) {
      interruptConfirmed = true
      await waitForClaudePromptCancellation(cancellationObserved, timeoutMs)
      if (!input.admitPromptCancellation(session, claim.found.prompt.promptKey)) {
        throw new Error(`Claude prompt cancellation lifecycle was not admitted for ${claim.itemId}`)
      }
    } else if (claim) {
      session.prompts.releaseClaim(claim)
    }
    return result
  } catch (error) {
    if (claim && !interruptConfirmed) {
      session.prompts.releaseClaim(claim)
    }
    throw error
  }
}

export async function answerClaudeStructuredPrompt(input: {
  request: AnswerInput
  sessions: Map<string, ClaudeSession>
}): Promise<void> {
  const { request, sessions } = input
  const session = sessions.get(request.sessionId)
  if (!session || session.fence !== request.fence) {
    throw new AgentSessionPromptUnavailableError(request.itemId)
  }
  const acquisitionGeneration = session.acquisitionGeneration
  const claim = session.prompts.claim(request.itemId, request.kind)
  if (!claim) {
    throw new AgentSessionPromptUnavailableError(request.itemId)
  }
  try {
    await request.commit()
    if (
      sessions.get(request.sessionId) !== session ||
      session.fence !== request.fence ||
      session.acquisitionGeneration !== acquisitionGeneration ||
      !session.prompts.ownsClaim(claim)
    ) {
      throw new AgentSessionPromptUnavailableError(request.itemId)
    }
    await answerClaudePrompt(session, claim, request.optionId)
  } catch (error) {
    session.prompts.releaseClaim(claim)
    throw error
  }
}
