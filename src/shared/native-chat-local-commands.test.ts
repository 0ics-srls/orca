import { describe, expect, it } from 'vitest'
import { nativeChatLocalCommand } from './native-chat-local-commands'

describe('nativeChatLocalCommand', () => {
  it('claims /context for Claude-family agents, with or without arguments', () => {
    expect(nativeChatLocalCommand('claude', '/context')).toBe('context')
    expect(nativeChatLocalCommand('claude', '/context all')).toBe('context')
    expect(nativeChatLocalCommand('openclaude', '/context')).toBe('context')
  })

  it('leaves every other draft to the agent', () => {
    expect(nativeChatLocalCommand('claude', '/compact')).toBeNull()
    expect(nativeChatLocalCommand('claude', 'what is my /context')).toBeNull()
    expect(nativeChatLocalCommand('claude', '/contextual')).toBeNull()
    expect(nativeChatLocalCommand('codex', '/context')).toBeNull()
  })

  it('treats a leading space as prose, as the TUIs do', () => {
    expect(nativeChatLocalCommand('claude', ' /context')).toBeNull()
  })
})
