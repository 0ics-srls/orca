import { describe, expect, it } from 'vitest'
import { nativeChatLocalCommand } from './native-chat-local-commands'

describe('nativeChatLocalCommand', () => {
  it('claims /context for OMP, with or without arguments', () => {
    expect(nativeChatLocalCommand('omp', '/context')).toBe('context')
    expect(nativeChatLocalCommand('omp', '/context all')).toBe('context')
  })

  it('leaves /context to agents whose CLI answers it', () => {
    // OpenClaude writes its own report to the transcript; Claude and Codex answer
    // in their structured sessions.
    expect(nativeChatLocalCommand('openclaude', '/context')).toBeNull()
    expect(nativeChatLocalCommand('claude', '/context')).toBeNull()
    expect(nativeChatLocalCommand('codex', '/context')).toBeNull()
  })

  it('leaves every other draft to the agent', () => {
    expect(nativeChatLocalCommand('omp', '/compact')).toBeNull()
    expect(nativeChatLocalCommand('omp', 'what is my /context')).toBeNull()
    expect(nativeChatLocalCommand('omp', '/contextual')).toBeNull()
  })

  it('treats a leading space as prose, as the TUIs do', () => {
    expect(nativeChatLocalCommand('omp', ' /context')).toBeNull()
  })
})
