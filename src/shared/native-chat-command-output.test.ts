import { describe, expect, it } from 'vitest'
import {
  surfaceNativeChatCommandOutputs,
  withoutSurfacedOutputCommands
} from './native-chat-command-output'
import { getAgentSlashCommands } from './native-chat-slash-commands'
import { stripNoiseMessages } from './native-chat-noise'
import type { NativeChatMessage } from './native-chat-types'

// The two user rows OpenClaude 0.31.0 writes for `/context` (its caveat row is
// `isMeta` and never decoded), as the transcript decoder emits them.
const CONTEXT_ENVELOPE =
  '<command-name>/context</command-name>\n            <command-message>context</command-message>\n            <command-args></command-args>'
const CONTEXT_STDOUT =
  '<local-command-stdout> \u001b[1mContext Usage\u001b[22m\n\u001b[38;5;244m\u26c1 \u26c1 \u26c1 \u26c1 \u26c1 \u26c1 \u001b[38;5;246m\u26c1 \u26c1 \u26c1 \u26c1 \u001b[39m  \u001b[38;5;246mgpt-4o \u00b7 16.6k/128k tokens (13%)\u001b[39m\n\n\u001b[38;5;246m\u26c1 \u26c1 \u26c0 \u001b[38;5;220m\u26c0 \u001b[38;5;246m\u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u001b[39m  \u001b[38;5;246m\u001b[3mEstimated usage by category\u001b[23m\u001b[39m\n                      \u001b[38;5;244m\u26c1\u001b[39m System prompt: \u001b[38;5;246m7.9k tokens (6.1%)\u001b[39m\n\u001b[38;5;246m\u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u001b[39m  \u001b[38;5;246m\u26c1\u001b[39m System tools: \u001b[38;5;246m8.5k tokens (6.6%)\u001b[39m\n                      \u001b[38;5;220m\u26c1\u001b[39m Skills: \u001b[38;5;246m304 tokens (0.2%)\u001b[39m\n\u001b[38;5;246m\u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u001b[39m  \u001b[38;5;246m\u26f6\u001b[39m Free space: \u001b[38;5;246m65k (50.8%)\u001b[39m\n                      \u001b[38;5;246m\u26dd Autocompact buffer: 46.4k tokens (36.2%)\u001b[39m\n\u001b[38;5;246m\u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u001b[39m\n\n\u001b[38;5;246m\u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u001b[39m\n\n\u001b[38;5;246m\u26f6 \u26f6 \u26f6 \u26f6 \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u001b[39m\n\n\u001b[38;5;246m\u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u001b[39m\n\n\u001b[38;5;246m\u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u001b[39m\n\n\u001b[38;5;246m\u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u26dd \u001b[39m\n\n\n\u001b[1mSkills\u001b[22m\u001b[38;5;246m \u00b7 /skills\u001b[39m</local-command-stdout>'

function userTurn(id: string, text: string, timestamp: number | null = 100): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp, source: 'transcript' }
}

const envelope = (name: string, id = 'env', timestamp = 100): NativeChatMessage =>
  userTurn(id, CONTEXT_ENVELOPE.replaceAll('context', name), timestamp)

describe('surfaceNativeChatCommandOutputs', () => {
  it("shows OpenClaude's /context report as plain command output", () => {
    const [shown] = surfaceNativeChatCommandOutputs(
      [userTurn('out', CONTEXT_STDOUT), envelope('context')],
      'openclaude'
    )
    expect(shown).toMatchObject({ id: 'out', role: 'system' })
    const block = shown?.blocks[0]
    expect(block).toMatchObject({ type: 'text', presentation: 'command-output' })
    const text = block?.type === 'text' ? block.text : ''
    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('local-command-stdout')
    // Column layout survives: the legend stays indented past the grid.
    expect(text.split('\n').slice(0, 5)).toEqual([
      'Context Usage',
      '\u26c1 \u26c1 \u26c1 \u26c1 \u26c1 \u26c1 \u26c1 \u26c1 \u26c1 \u26c1   gpt-4o \u00b7 16.6k/128k tokens (13%)',
      '',
      '\u26c1 \u26c1 \u26c0 \u26c0 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6 \u26f6   Estimated usage by category',
      '                      \u26c1 System prompt: 7.9k tokens (6.1%)'
    ])
  })

  it('survives the noise filter while the command envelope stays hidden', () => {
    const visible = stripNoiseMessages(
      surfaceNativeChatCommandOutputs(
        [envelope('context'), userTurn('out', CONTEXT_STDOUT)],
        'openclaude'
      )
    )
    expect(visible.map(({ id }) => id)).toEqual(['out'])
  })

  it('pairs a reply with the newest command written at or before it', () => {
    const modelReply = userTurn(
      'model-out',
      '<local-command-stdout>Set model to gpt-4o</local-command-stdout>',
      300
    )
    const messages = [
      envelope('context', 'env-1', 100),
      userTurn('out', CONTEXT_STDOUT, 100),
      envelope('model', 'env-2', 300),
      modelReply
    ]
    const surfaced = surfaceNativeChatCommandOutputs(messages, 'openclaude')
    expect(surfaced.find(({ id }) => id === 'out')?.role).toBe('system')
    // Replies to commands whose effect is the feedback stay hidden.
    expect(surfaced.find(({ id }) => id === 'model-out')).toBe(modelReply)
  })

  it('leaves other agents and unpaired replies untouched', () => {
    const messages = [envelope('context'), userTurn('out', CONTEXT_STDOUT)]
    // Claude's TUI writes no reply row; one that appears is left to the noise filter.
    expect(surfaceNativeChatCommandOutputs(messages, 'claude')).toBe(messages)
    const orphan = [userTurn('out', CONTEXT_STDOUT, 50), envelope('context', 'env', 100)]
    expect(surfaceNativeChatCommandOutputs(orphan, 'openclaude')).toBe(orphan)
  })
})

describe('withoutSurfacedOutputCommands', () => {
  it('drops only commands answered by a surfaced reply', () => {
    const names = (agent: string) =>
      withoutSurfacedOutputCommands(agent, getAgentSlashCommands(agent)).map(({ name }) => name)
    expect(names('openclaude')).toEqual(getAgentSlashCommands('claude').map(({ name }) => name))
    const omp = getAgentSlashCommands('omp')
    expect(withoutSurfacedOutputCommands('omp', omp)).toBe(omp)
  })
})
