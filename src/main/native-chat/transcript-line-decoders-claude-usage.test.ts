import { describe, expect, it } from 'vitest'
import { decodeClaudeTranscriptLine } from './transcript-line-decoders-claude'

// Verbatim shape of an assistant record, Claude Code 2.1.270.
const ASSISTANT_ROW = JSON.stringify({
  type: 'assistant',
  uuid: 'assistant-uuid',
  timestamp: '2026-09-22T16:51:24.759Z',
  message: {
    model: 'claude-fable-5-1',
    role: 'assistant',
    content: [{ type: 'text', text: 'pong' }],
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 24615,
      cache_read_input_tokens: 0,
      output_tokens: 4,
      service_tier: 'standard'
    }
  }
})

// The row the CLI synthesizes to deliver a local command's output.
const SYNTHETIC_ROW = JSON.stringify({
  type: 'assistant',
  uuid: 'synthetic-uuid',
  timestamp: '2026-09-22T16:51:30.000Z',
  message: {
    model: '<synthetic>',
    role: 'assistant',
    content: [{ type: 'text', text: '## Context Usage' }],
    usage: {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0
    }
  }
})

describe('Claude assistant usage', () => {
  it('keeps the model and the API usage counts on an assistant row', () => {
    const decoded = decodeClaudeTranscriptLine(ASSISTANT_ROW, 'fallback')
    expect(decoded?.model).toBe('claude-fable-5-1')
    expect(decoded?.usage).toEqual({
      inputTokens: 2,
      cacheCreationInputTokens: 24615,
      cacheReadInputTokens: 0,
      outputTokens: 4
    })
  })

  it('records no usage for a synthesized row, which says nothing about the window', () => {
    const decoded = decodeClaudeTranscriptLine(SYNTHETIC_ROW, 'fallback')
    expect(decoded?.model).toBe('<synthetic>')
    expect(decoded?.usage).toBeUndefined()
  })

  it('never attaches usage to a user row', () => {
    const decoded = decodeClaudeTranscriptLine(
      JSON.stringify({
        type: 'user',
        uuid: 'user-uuid',
        message: { role: 'user', content: 'hi', usage: { input_tokens: 9 } }
      }),
      'fallback'
    )
    expect(decoded?.usage).toBeUndefined()
    expect(decoded?.model).toBeUndefined()
  })
})
