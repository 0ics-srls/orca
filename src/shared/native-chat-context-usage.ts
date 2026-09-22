// Context usage a chat surface can derive from the transcript alone. Claude's
// statusline computes `ctx N%` from the last API response's input, cache-write
// and cache-read tokens against the model's window; this is the same arithmetic,
// so chat and terminal agree on the number.

import type { AgentType } from './agent-status-types'
import { claudeContextWindowTokens } from './claude-context-window'
import type { NativeChatMessage, NativeChatTokenUsage } from './native-chat-types'

export type NativeChatContextUsage = {
  usedTokens: number
  windowTokens: number
  /** Rounded and never clamped: an over-limit turn reads above 100. */
  percentage: number
  model: string | null
  /** Derived from the last response rather than counted by the provider. */
  estimated: true
  /** Timestamp of the response the estimate comes from. */
  observedAt: number | null
}

/** Everything the model read on the last request, which is what fills the window. */
export function contextTokensFromUsage(usage: NativeChatTokenUsage): number {
  return usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens
}

function contextWindowTokens(agent: AgentType, model: string | null): number | null {
  return agent === 'claude' || agent === 'openclaude' ? claudeContextWindowTokens(model) : null
}

/** The newest assistant response that carried usage decides; rows the CLI
 *  synthesizes (local command output) carry none and are skipped. */
export function deriveNativeChatContextUsage(
  messages: readonly NativeChatMessage[],
  agent: AgentType
): NativeChatContextUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role !== 'assistant' || !message.usage) {
      continue
    }
    const usedTokens = contextTokensFromUsage(message.usage)
    if (usedTokens <= 0) {
      continue
    }
    const model = message.model ?? null
    const windowTokens = contextWindowTokens(agent, model)
    if (windowTokens === null) {
      return null
    }
    return {
      usedTokens,
      windowTokens,
      percentage: Math.round((usedTokens / windowTokens) * 100),
      model,
      estimated: true,
      observedAt: message.timestamp
    }
  }
  return null
}

/** `18.6k`, `1m`, `981.4k` — the CLI's own compact token notation. */
export function formatContextTokenCount(tokens: number): string {
  const safe = Math.max(0, tokens)
  if (safe >= 1_000_000) {
    return `${trimZero((safe / 1_000_000).toFixed(1))}m`
  }
  if (safe >= 1_000) {
    return `${trimZero((safe / 1_000).toFixed(1))}k`
  }
  return String(Math.round(safe))
}

function trimZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value
}
