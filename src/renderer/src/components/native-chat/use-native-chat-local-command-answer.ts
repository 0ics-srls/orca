import { useCallback } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { deriveNativeChatContextUsage } from '../../../../shared/native-chat-context-usage'
import { nativeChatLocalCommand } from '../../../../shared/native-chat-local-commands'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { latestCommandSentAt, type NativeChatCommandMarker } from './native-chat-command-marker'
import {
  formatNativeChatContextUsageAnswer,
  formatNativeChatContextUsageUnreported
} from './native-chat-context-usage-answer'

/** Answers a command the chat host owns over a terminal session, or null to send it. */
export type NativeChatLocalCommandAnswer = (
  command: string,
  resolvedSessionModel: string | null
) => string | null

/** Claude's `/context` paints a grid the chat never sees, so the host replies with
 *  the same estimate the CLI's statusline derives from the last response. */
export function answerNativeChatLocalCommand(args: {
  agent: AgentType
  command: string
  messages: readonly NativeChatMessage[]
  markers: readonly NativeChatCommandMarker[]
  resolvedSessionModel: string | null
}): string | null {
  if (nativeChatLocalCommand(args.agent, args.command) !== 'context') {
    return null
  }
  if (!sessionReportsUsage(args.messages)) {
    return formatNativeChatContextUsageUnreported()
  }
  const usage = deriveNativeChatContextUsage(args.messages, args.agent, args.resolvedSessionModel)
  // Why: decoded messages keep no compaction boundary and `/clear` lands late, so a
  // response older than either, sent from here, reports a context that is gone.
  const resetAt = Math.max(
    latestCommandSentAt(args.markers, '/compact') ?? -Infinity,
    latestCommandSentAt(args.markers, '/clear') ?? -Infinity
  )
  const stale =
    usage !== null &&
    Number.isFinite(resetAt) &&
    (usage.observedAt === null || usage.observedAt <= resetAt)
  return formatNativeChatContextUsageAnswer(stale ? null : usage)
}

/** False when the agent has answered yet no answer names its model: a host that
 *  predates usage decoding, or a scraped view, will never report usage. */
function sessionReportsUsage(messages: readonly NativeChatMessage[]): boolean {
  let answered = false
  for (const message of messages) {
    if (message.role !== 'assistant' || message.source === 'hook') {
      continue
    }
    if (message.model !== undefined) {
      return true
    }
    answered = true
  }
  return !answered
}

export function useNativeChatLocalCommandAnswer(
  agent: AgentType,
  messages: readonly NativeChatMessage[],
  markers: readonly NativeChatCommandMarker[]
): NativeChatLocalCommandAnswer {
  return useCallback(
    (command, resolvedSessionModel) =>
      answerNativeChatLocalCommand({ agent, command, messages, markers, resolvedSessionModel }),
    [agent, markers, messages]
  )
}
