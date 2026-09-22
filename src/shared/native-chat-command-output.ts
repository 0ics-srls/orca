// Claude-family harnesses record a local command's reply as a
// `<local-command-stdout>` user turn next to the command's envelope. The noise
// filter hides those rows, which is right for commands whose effect is the
// feedback (`/model`, `/compact`). For a command that exists to report
// something, the reply is the answer, so the chat surfaces it.

import type { AgentType } from './agent-status-types'
import { stripAnsiEscapeSequences } from './ansi-escape-sequences'
import { parseNativeChatCommandEnvelope } from './native-chat-command-envelope'
import { isTextBlock, type NativeChatMessage } from './native-chat-types'

// Why: opt-in per agent; Claude's TUI writes no reply row for these, OpenClaude does.
const SURFACED_COMMAND_OUTPUTS: Partial<Record<AgentType, ReadonlySet<string>>> = {
  openclaude: new Set(['context'])
}

const LOCAL_COMMAND_STDOUT = /^\s*<local-command-stdout>([\s\S]*?)<\/local-command-stdout>\s*$/

function userText(message: NativeChatMessage): string | null {
  return message.role === 'user' && message.blocks.every(isTextBlock)
    ? message.blocks.map((block) => block.text).join('\n')
    : null
}

/** The command a user turn's envelope names, without its slash; null for other turns. */
function envelopeCommand(message: NativeChatMessage): string | null {
  const text = userText(message)
  const envelope = text === null ? null : parseNativeChatCommandEnvelope(text)
  return envelope ? envelope.name.replace(/^\//, '') : null
}

/**
 * Replace the stdout row answering an opted-in command with its plain text as
 * command output. A reply pairs with the newest envelope written at or before
 * it: the harness writes both in one batch, often with the same timestamp, and
 * the transcript order breaks such ties by id rather than by write order.
 */
export function surfaceNativeChatCommandOutputs(
  messages: NativeChatMessage[],
  agent: AgentType
): NativeChatMessage[] {
  const surfaced = SURFACED_COMMAND_OUTPUTS[agent]
  if (!surfaced) {
    return messages
  }
  const envelopes: { command: string; timestamp: number }[] = []
  for (const message of messages) {
    const command = envelopeCommand(message)
    if (command !== null && message.timestamp !== null) {
      envelopes.push({ command, timestamp: message.timestamp })
    }
  }
  if (envelopes.length === 0) {
    return messages
  }
  let changed = false
  const out = messages.map((message) => {
    const stdout = LOCAL_COMMAND_STDOUT.exec(userText(message) ?? '')?.[1]
    if (stdout === undefined || message.timestamp === null) {
      return message
    }
    const answering = answeringCommand(envelopes, message.timestamp)
    if (answering === null || !surfaced.has(answering)) {
      return message
    }
    const text = stripAnsiEscapeSequences(stdout).trim()
    if (!text) {
      return message
    }
    changed = true
    return {
      ...message,
      role: 'system' as const,
      blocks: [{ type: 'text' as const, text, presentation: 'command-output' }]
    }
  })
  return changed ? out : messages
}

function answeringCommand(
  envelopes: readonly { command: string; timestamp: number }[],
  timestamp: number
): string | null {
  let best: { command: string; timestamp: number } | null = null
  for (const envelope of envelopes) {
    if (envelope.timestamp <= timestamp && (best === null || envelope.timestamp > best.timestamp)) {
      best = envelope
    }
  }
  return best?.command ?? null
}
