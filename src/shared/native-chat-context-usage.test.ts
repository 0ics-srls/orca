import { describe, expect, it } from 'vitest'
import { claudeContextWindowTokens } from './claude-context-window'
import { deriveNativeChatContextUsage, formatContextTokenCount } from './native-chat-context-usage'
import type { NativeChatMessage } from './native-chat-types'

// Transcripts record the model without its `[1m]` suffix, even for a 1M session.
function assistant(
  id: string,
  usage: NativeChatMessage['usage'],
  model = 'claude-opus-5-5',
  timestamp: number | null = 100
): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text: id }],
    timestamp,
    source: 'transcript',
    model,
    ...(usage ? { usage } : {})
  }
}

function usage(inputTokens: number, cacheRead = 0): NativeChatMessage['usage'] {
  return {
    inputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: cacheRead,
    outputTokens: 1
  }
}

describe('claudeContextWindowTokens', () => {
  it('reads 1M from the resolved `[1m]` id when the transcript names the same model', () => {
    expect(claudeContextWindowTokens('claude-opus-5-5[1m]', 'claude-opus-5-5')).toBe(1_000_000)
    expect(claudeContextWindowTokens('claude-fable-5-1[1m]', 'claude-fable-5-1')).toBe(1_000_000)
  })

  it('does not guess a window for an id without the suffix', () => {
    // The CLI sizes these by account, provider and environment.
    expect(claudeContextWindowTokens('claude-sonnet-5', 'claude-sonnet-5')).toBeNull()
    expect(
      claudeContextWindowTokens('claude-haiku-4-5-20251001', 'claude-haiku-4-5-20251001')
    ).toBe(null)
  })

  it('is unknown without a resolved session model', () => {
    expect(claudeContextWindowTokens(null, 'claude-opus-5-5')).toBeNull()
  })

  it('distrusts a tracked model the transcript contradicts', () => {
    expect(claudeContextWindowTokens('claude-opus-5-5[1m]', 'claude-sonnet-5')).toBeNull()
    expect(claudeContextWindowTokens('claude-fable-5-1[1m]', 'claude-fable-5')).toBeNull()
    expect(claudeContextWindowTokens('claude-opus-5-5[1m]', null)).toBeNull()
  })
})

describe('deriveNativeChatContextUsage', () => {
  it('sums input and both cache counts of the newest response against the resolved window', () => {
    const messages = [
      assistant('older', usage(5)),
      assistant(
        'newest',
        {
          inputTokens: 2,
          cacheCreationInputTokens: 24_615,
          cacheReadInputTokens: 425_383,
          outputTokens: 4
        },
        'claude-opus-5-5',
        200
      )
    ]
    expect(deriveNativeChatContextUsage(messages, 'claude', 'claude-opus-5-5[1m]')).toEqual({
      usedTokens: 450_000,
      windowTokens: 1_000_000,
      percentage: 45,
      model: 'claude-opus-5-5',
      estimated: true,
      observedAt: 200
    })
  })

  it('reports the used figure alone when the window is unknown', () => {
    const derived = deriveNativeChatContextUsage(
      [assistant('a', usage(450_000), 'claude-opus-5-5')],
      'claude'
    )
    expect(derived).toMatchObject({ usedTokens: 450_000, windowTokens: null, percentage: null })
  })

  it('skips responses without usage, such as a synthesized local command reply', () => {
    const messages = [
      assistant('real', usage(100)),
      assistant('synthetic', undefined, '<synthetic>')
    ]
    expect(deriveNativeChatContextUsage(messages, 'claude')?.usedTokens).toBe(100)
  })

  it('is null before any response carried usage, and for agents it does not cover', () => {
    expect(deriveNativeChatContextUsage([], 'claude')).toBeNull()
    expect(deriveNativeChatContextUsage([assistant('c', usage(10))], 'codex')).toBeNull()
  })
})

describe('formatContextTokenCount', () => {
  it('uses the compact notation the CLI prints', () => {
    expect(formatContextTokenCount(10)).toBe('10')
    expect(formatContextTokenCount(18_600)).toBe('18.6k')
    expect(formatContextTokenCount(200_000)).toBe('200k')
    expect(formatContextTokenCount(981_400)).toBe('981.4k')
    expect(formatContextTokenCount(1_000_000)).toBe('1m')
    expect(formatContextTokenCount(-5)).toBe('0')
  })
})
