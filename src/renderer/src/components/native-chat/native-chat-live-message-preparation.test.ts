import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { prepareNativeChatLiveMessages } from './native-chat-live-message-preparation'
import { createNativeChatMessageListProjection } from './native-chat-message-list-projection'

const row = (id: string, text: string, source: NativeChatMessage['source'] = 'transcript') => ({
  id,
  role: 'user' as const,
  blocks: [{ type: 'text' as const, text }],
  timestamp: 100,
  source
})

const CONTEXT_ROWS: NativeChatMessage[] = [
  row('b-envelope', '<command-name>/context</command-name>\n<command-args></command-args>'),
  row('a-stdout', '<local-command-stdout> \u001b[1mContext Usage\u001b[22m</local-command-stdout>')
]

function visibleText(agent: 'openclaude' | 'claude', messages: NativeChatMessage[]): string[] {
  return createNativeChatMessageListProjection()(
    prepareNativeChatLiveMessages(messages, agent)
  ).flatMap((message) => message.blocks.map((block) => (block.type === 'text' ? block.text : '')))
}

describe('prepareNativeChatLiveMessages command output', () => {
  it("lists OpenClaude's /context report in the chat", () => {
    expect(visibleText('openclaude', CONTEXT_ROWS)).toEqual(['Context Usage'])
    // A live hook preview alongside the transcript takes the reassembly path.
    expect(
      visibleText('openclaude', [...CONTEXT_ROWS, row('hook', 'next prompt', 'hook')])
    ).toEqual(['Context Usage', 'next prompt'])
  })

  it('keeps the reply row hidden for Claude', () => {
    // Outside Claude's catalog the envelope reads as the typed turn, as on main.
    expect(visibleText('claude', CONTEXT_ROWS)).toEqual(['/context'])
  })
})
