import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import type { NativeChatBlock } from '../../shared/native-chat-types'
import type { AgentSessionDispatchOutcome } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import {
  isCodexAppServerRequestError,
  type CodexAppServerConnection
} from './codex-app-server-connection'
import { isCodexAppServerUnsupportedError } from './codex-app-server-session'
import type { CodexDispatchEchoes } from './codex-structured-dispatch-echo'
import { DISPATCH_REJECTED_CODEX_QUEUE_FULL } from '../../shared/structured-agent-session-dispatch-rejection'
import { decodeStructuredAgentSessionOptionValue } from '../../shared/structured-agent-session-option-codec'
import { DISPATCH_DOUBT_TURN_SETTLED } from '../native-chat/agent-session-journal/journal-dispatch-doubt-reasons'
import { readCodexTurnId } from './codex-structured-thread-facts'

// Writing a Codex turn and learning which message landed where, which are not
// the same event. `turn/start` answers as soon as Codex owns the message, but a
// message issued while a turn is running is COALESCED into that turn. Across
// supported app-server builds, the response id is not authoritative for that
// steer, so ownership comes from the active lifecycle at write time. The user
// message echo remains the final delivery proof.

/** Keys Codex accepts as per-turn overrides. An unlisted key would otherwise
 *  become an arbitrary client-controlled `turn/start` parameter. */
const CODEX_TURN_OPTION_KEYS = new Set([
  'model',
  'effort',
  'approvalPolicy',
  'approvalsReviewer',
  'personality',
  'serviceTier',
  'fastMode'
])

export function isCodexTurnOptionKey(key: string): boolean {
  return CODEX_TURN_OPTION_KEYS.has(key)
}

/** The session state one turn needs. */
export type CodexTurnHost = {
  connection: Pick<CodexAppServerConnection, 'request'>
  threadId: string
  options: Map<string, string>
  reportedOptions?: { model?: string }
  fastModeTierByModel: ReadonlyMap<string, string>
  dispatchEchoes: CodexDispatchEchoes
  activeTurnIds?: ReadonlySet<string>
}

function currentActiveTurnId(host: CodexTurnHost): string | null {
  let current: string | null = null
  for (const turnId of host.activeTurnIds ?? []) {
    current = turnId
  }
  return current
}

function turnInputFor(body: AgentJournalMessageItem): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = []
  for (const block of body.blocks as NativeChatBlock[]) {
    if (block.type === 'text' && block.text.length > 0) {
      input.push({ type: 'text', text: block.text })
    } else if (block.type === 'image-ref' && block.path) {
      input.push({ type: 'localImage', path: block.path })
    } else if (block.type === 'image-ref' && block.url) {
      input.push({ type: 'image', url: block.url })
    }
  }
  return input
}

function codexTurnOptions(host: CodexTurnHost): Record<string, string> {
  const options = Object.fromEntries(
    [...host.options].filter(([key]) => key !== 'fastMode' && key !== 'serviceTier')
  )
  const encodedFastMode = host.options.get('fastMode')
  if (encodedFastMode === undefined) {
    return options
  }
  const fastMode = decodeStructuredAgentSessionOptionValue('fastMode', encodedFastMode)
  if (typeof fastMode !== 'boolean') {
    throw new Error('codex fast mode must be encoded as true or false')
  }
  if (!fastMode) {
    return { ...options, serviceTier: 'default' }
  }
  const model = host.options.get('model') ?? host.reportedOptions?.model
  const tierId = model ? host.fastModeTierByModel.get(model) : undefined
  // Fast is on but nothing has named the tier for this model yet, so there is no
  // value to route to. Deliberately Standard rather than an omission: the tier
  // persists on the thread, so omitting would silently keep routing a paid tier we
  // cannot currently name, and discovery recovers the exact tier on a later turn.
  if (!tierId) {
    return { ...options, serviceTier: 'default' }
  }
  return { ...options, serviceTier: tierId }
}

/**
 * Hands one submission to Codex and binds its client id to the provider-owned turn.
 */
export async function startCodexTurn(
  host: CodexTurnHost,
  input: { clientMessageId: string; body: AgentJournalMessageItem; timeoutMs?: number }
): Promise<'admitted' | 'owner-ended' | 'queue-full'> {
  // Armed before the write: the echo can land while the response is in flight.
  if (!host.dispatchEchoes.arm(input.clientMessageId)) {
    return 'queue-full'
  }
  const expectedOwnerTurnId = currentActiveTurnId(host)
  let ownerEnded = false
  if (expectedOwnerTurnId) {
    ownerEnded = host.dispatchEchoes.bindOwnerTurn(input.clientMessageId, expectedOwnerTurnId)
  }
  const bindResponseOwner = (result: unknown): void => {
    const turnId = expectedOwnerTurnId ?? readCodexTurnId(result)
    if (turnId) {
      ownerEnded = host.dispatchEchoes.bindOwnerTurn(input.clientMessageId, turnId) || ownerEnded
    }
  }
  const result = await host.connection.request(
    'turn/start',
    {
      threadId: host.threadId,
      clientUserMessageId: input.clientMessageId,
      input: turnInputFor(input.body),
      ...codexTurnOptions(host)
    },
    { timeoutMs: input.timeoutMs, onResult: bindResponseOwner }
  )
  // Also covers test and alternate connections that omit the synchronous observer.
  bindResponseOwner(result)
  return ownerEnded ? 'owner-ended' : 'admitted'
}

/**
 * One submission's outcome as the wire must read it: admitted means Codex owns
 * the message and its identity settles on the echo, rejected is Codex answering
 * and declining. Elapsed time is never evidence here, because the wait a
 * coalesced send would face is bounded only by the running turn.
 */
export async function dispatchCodexTurn(
  session: CodexTurnHost,
  input: { clientMessageId: string; body: AgentJournalMessageItem },
  timeoutMs: number | undefined
): Promise<AgentSessionDispatchOutcome> {
  try {
    const admission = await startCodexTurn(session, { ...input, timeoutMs })
    if (admission === 'queue-full') {
      return { state: 'rejected', reason: DISPATCH_REJECTED_CODEX_QUEUE_FULL }
    }
    if (admission === 'owner-ended') {
      return {
        state: 'unknown',
        reason: DISPATCH_DOUBT_TURN_SETTLED,
        recovered: true
      }
    }
  } catch (error) {
    if (isCodexAppServerRequestError(error) || isCodexAppServerUnsupportedError(error)) {
      // Codex answered and declined, so no echo for this write can arrive.
      session.dispatchEchoes.disarm(input.clientMessageId)
      return { state: 'rejected', reason: (error as Error).message }
    }
    // A timeout or transport failure can happen after the frame was written.
    // Keep the correlation armed so a later echo can prove delivery.
    throw error
  }
  return { state: 'admitted' }
}
