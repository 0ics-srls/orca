import { describe, expect, it } from 'vitest'
import { deriveNativeChatContextUsage, formatContextTokenCount } from './native-chat-context-usage'
import type { NativeChatMessage } from './native-chat-types'

function assistant(
  id: string,
  usage: NativeChatMessage['usage'],
  model = 'claude-fable-5-1',
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

describe('deriveNativeChatContextUsage', () => {
  it('sums input and both cache counts of the newest response against the standard window', () => {
    const messages = [
      assistant('older', {
        inputTokens: 5,
        cacheCreationInputTokens: 1_000,
        cacheReadInputTokens: 0,
        outputTokens: 10
      }),
      assistant(
        'newest',
        {
          inputTokens: 2,
          cacheCreationInputTokens: 24_615,
          cacheReadInputTokens: 30_000,
          outputTokens: 4
        },
        'claude-fable-5-1',
        200
      )
    ]
    expect(deriveNativeChatContextUsage(messages, 'claude')).toEqual({
      usedTokens: 54_617,
      windowTokens: 200_000,
      percentage: 27,
      model: 'claude-fable-5-1',
      estimated: true,
      observedAt: 200
    })
  })

  it('reads the 1M window from the [1m] model suffix', () => {
    const usage = deriveNativeChatContextUsage(
      [
        assistant(
          'a',
          {
            inputTokens: 18_600,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 1
          },
          'claude-fable-5-1[1m]'
        )
      ],
      'claude'
    )
    expect(usage?.windowTokens).toBe(1_000_000)
    expect(usage?.percentage).toBe(2)
  })

  it('skips responses without usage, such as a synthesized local command reply', () => {
    const messages = [
      assistant('real', {
        inputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 1
      }),
      assistant('synthetic', undefined, '<synthetic>', 300)
    ]
    expect(deriveNativeChatContextUsage(messages, 'claude')?.usedTokens).toBe(100)
  })

  it('is null before any response carried usage, and for agents without a known window', () => {
    expect(deriveNativeChatContextUsage([], 'claude')).toBeNull()
    const codex = [
      assistant('c', {
        inputTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 1
      })
    ]
    expect(deriveNativeChatContextUsage(codex, 'codex')).toBeNull()
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
