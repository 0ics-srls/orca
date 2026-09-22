// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModel } from '../../../../shared/agent-session-option-catalog'
import type { SessionOptionValue } from '../../../../shared/native-chat-session-options'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { readClaudeSessionOptionsFromTerminalScreen } from './claude-terminal-session-options'
import type { NativeChatCommandMarker } from './native-chat-command-marker'
import { createNativeChatPtySessionOptions } from './native-chat-pty-session-options'
import { clearNativeChatSessionOptionCacheForTests } from './native-chat-session-option-cache'
import {
  answerNativeChatLocalCommand,
  type NativeChatLocalCommandAnswer
} from './use-native-chat-local-command-answer'
import { useNativeChatPickerCommandDispatch } from './use-native-chat-picker-command-dispatch'
import { useNativeChatPtyComposerSend } from './use-native-chat-pty-composer-send'

const mocks = vi.hoisted(() => ({
  sendNativeChatMessage: vi.fn(() => ({ id: 'send' })),
  sendNativeChatMessageWithImageAttachments: vi.fn(() => ({ id: 'image-send' }))
}))

vi.mock('../../store', () => {
  const state = { clearNativeChatLaunchDraft: vi.fn() }
  return { useAppStore: { getState: () => state } }
})
vi.mock('./native-chat-runtime-send', () => ({
  sendNativeChatMessage: mocks.sendNativeChatMessage,
  sendNativeChatTypedCommand: vi.fn(),
  submitNativeChatPrompt: vi.fn()
}))
vi.mock('./native-chat-runtime-image-send', () => ({
  sendNativeChatMessageWithImageAttachments: mocks.sendNativeChatMessageWithImageAttachments
}))
vi.mock('@/lib/native-chat-telemetry', () => ({
  emitNativeChatMessageSent: vi.fn(),
  emitNativeChatPickerItemAccepted: vi.fn(),
  emitNativeChatSendClassified: vi.fn()
}))

// `list_models` rows as Claude Code 2.1.280 reports them, `resolvedModel` included.
const DISCOVERED: CatalogModel[] = [
  { id: 'opus[1m]', label: 'Opus (1M context)', resolvedModel: 'claude-opus-5-5[1m]', options: [] },
  { id: 'sonnet', label: 'Sonnet', resolvedModel: 'claude-sonnet-5', options: [] },
  {
    id: 'sonnet[1m]',
    label: 'Sonnet 5 (1M context)',
    resolvedModel: 'claude-sonnet-5[1m]',
    options: []
  },
  { id: 'haiku', label: 'Haiku', resolvedModel: 'claude-haiku-4-5-20251001', options: [] }
]

// A 1M session's transcript still records the bare id.
function response(tokens: number, timestamp: number, model = 'claude-opus-5-5'): NativeChatMessage {
  return {
    id: `a-${timestamp}`,
    role: 'assistant',
    blocks: [{ type: 'text', text: 'ok' }],
    timestamp,
    source: 'transcript',
    model,
    usage: {
      inputTokens: 2,
      cacheCreationInputTokens: 1_000,
      cacheReadInputTokens: tokens - 1_002,
      outputTokens: 40
    }
  }
}

function marker(command: string, sentAt: number): NativeChatCommandMarker {
  return { id: `${sentAt}`, command, sentAt }
}

function liveSurface(
  reportedValues: Record<string, SessionOptionValue> | null,
  models?: CatalogModel[]
) {
  return createNativeChatPtySessionOptions({
    agent: 'claude',
    scopeKey: 'pty-context',
    ...(models ? { initialModels: models } : {}),
    mode: 'live',
    reportedValues,
    dispatchCommand: vi.fn()
  })!
}

beforeEach(() => {
  clearNativeChatSessionOptionCacheForTests()
  mocks.sendNativeChatMessage.mockClear()
  mocks.sendNativeChatMessageWithImageAttachments.mockClear()
})

describe('the session model the /context window is read from', () => {
  it('resolves the terminal header through the host catalog to the CLI id', () => {
    const header = readClaudeSessionOptionsFromTerminalScreen(
      'Claude Code v2.1.280\r\nOpus 5.5 (1M context) with high effort · API Usage Billing\r\n~/repo',
      DISCOVERED
    )
    expect(liveSurface(header, DISCOVERED).resolvedSessionModel()).toBe('claude-opus-5-5[1m]')
  })

  it('follows a /model switch sent from the chat', () => {
    const surface = liveSurface({ model: 'opus[1m]' }, DISCOVERED)
    surface.recordOutgoingCommand('/model sonnet')
    expect(surface.resolvedSessionModel()).toBe('claude-sonnet-5')
  })

  it('names nothing before a probe, or when no model is tracked', () => {
    expect(liveSurface({ model: 'opus' }).resolvedSessionModel()).toBeNull()
    expect(liveSurface(null, DISCOVERED).resolvedSessionModel()).toBeNull()
  })
})

describe('answerNativeChatLocalCommand', () => {
  function answer(args: {
    messages: NativeChatMessage[]
    resolvedSessionModel?: string | null
    markers?: NativeChatCommandMarker[]
    command?: string
  }): string | null {
    return answerNativeChatLocalCommand({
      agent: 'claude',
      command: args.command ?? '/context',
      messages: args.messages,
      markers: args.markers ?? [],
      resolvedSessionModel: args.resolvedSessionModel ?? null
    })
  }

  it('states the 1M window for a session the host resolves to a [1m] model', () => {
    expect(
      answer({ messages: [response(450_000, 10)], resolvedSessionModel: 'claude-opus-5-5[1m]' })
    ).toBe('Context: 450k / 1m tokens (45%), estimated from the last response.')
  })

  it('gives the used figure alone rather than guess a window', () => {
    const used = 'Context: 54.6k tokens used, estimated from the last response.'
    // Untracked session.
    expect(answer({ messages: [response(54_600, 10)] })).toBe(used)
    // A model whose window the CLI decides by account and provider.
    expect(
      answer({
        messages: [response(54_600, 10, 'claude-sonnet-5')],
        resolvedSessionModel: 'claude-sonnet-5'
      })
    ).toBe(used)
    // The tracked model is stale: the transcript shows another model answering.
    expect(
      answer({
        messages: [response(54_600, 10, 'claude-sonnet-5')],
        resolvedSessionModel: 'claude-opus-5-5[1m]'
      })
    ).toBe(used)
  })

  it('reports nothing until a response lands after a /compact or /clear sent here', () => {
    const unavailable =
      'Context usage is not known yet. It becomes available once the agent has answered in this session.'
    const messages = [response(450_000, 10)]
    expect(answer({ messages, markers: [marker('/compact', 20)] })).toBe(unavailable)
    expect(answer({ messages, markers: [marker('/clear', 20)] })).toBe(unavailable)
    expect(
      answer({
        messages: [...messages, response(30_000, 30)],
        markers: [marker('/compact', 20)],
        resolvedSessionModel: 'claude-opus-5-5[1m]'
      })
    ).toBe('Context: 30k / 1m tokens (3%), estimated from the last response.')
  })

  it('does not promise a later answer when the host never reports usage', () => {
    const pending =
      'Context usage is not known yet. It becomes available once the agent has answered in this session.'
    const { model: _model, usage: _usage, ...olderHostRow } = response(54_600, 10)
    // An older host decodes the same reply without its model or usage.
    expect(answer({ messages: [olderHostRow] })).toBe(
      'Context usage is not available for this session.'
    )
    expect(answer({ messages: [] })).toBe(pending)
    // A live preview is not an answer the host decoded.
    expect(answer({ messages: [{ ...olderHostRow, source: 'hook' }] })).toBe(pending)
  })

  it('leaves every other command to the agent', () => {
    expect(answer({ messages: [], command: '/compact' })).toBeNull()
  })
})

describe('host-answered /context in the composer', () => {
  const target = { ptyId: 'pty-1', settings: {} }

  function composerArgs(answerCommandLocally: NativeChatLocalCommandAnswer) {
    return {
      agent: 'claude' as const,
      disabled: false,
      isDispatchingSessionOption: false,
      resolveTarget: () => target,
      onSlashCommand: vi.fn(),
      answerCommandLocally,
      sessionOptionsSurface: liveSurface({ model: 'opus[1m]' }, DISCOVERED),
      trackPendingSend: vi.fn(),
      setHistory: vi.fn(),
      setDraft: vi.fn(),
      setCaret: vi.fn(),
      clearSkillOrigin: vi.fn(),
      clearImageAttachments: vi.fn(),
      setNotice: vi.fn()
    }
  }

  function typedSend(draft: string, answerCommandLocally: NativeChatLocalCommandAnswer) {
    const args = {
      ...composerArgs(answerCommandLocally),
      draft,
      imageAttachments: [{ path: '/tmp/shot.png' }],
      launchDraftResolved: true,
      classifySend: () => 'command' as const,
      terminalTabId: 'tab-1'
    }
    const { result } = renderHook(() => useNativeChatPtyComposerSend(args))
    result.current()
    return args
  }

  it('answers a typed /context in the chat with the session model, keeping attachments', () => {
    const answerCommandLocally = vi.fn(() => 'Context: 450k / 1m tokens (45%)')
    const args = typedSend('/context', answerCommandLocally)
    expect(answerCommandLocally).toHaveBeenCalledWith('/context', 'claude-opus-5-5[1m]')
    expect(args.onSlashCommand).toHaveBeenCalledWith('/context', 'Context: 450k / 1m tokens (45%)')
    expect(mocks.sendNativeChatMessage).not.toHaveBeenCalled()
    expect(mocks.sendNativeChatMessageWithImageAttachments).not.toHaveBeenCalled()
    expect(args.clearImageAttachments).not.toHaveBeenCalled()
    expect(args.setDraft).toHaveBeenCalledWith('')
  })

  it('still sends a command the host does not answer, attachments included', () => {
    const args = typedSend('/compact', () => null)
    expect(mocks.sendNativeChatMessageWithImageAttachments).toHaveBeenCalled()
    expect(args.onSlashCommand).toHaveBeenCalledWith('/compact')
  })

  it('answers a picked /context the same way as a typed one', () => {
    const answerCommandLocally = vi.fn(() => 'Context: 450k / 1m tokens (45%)')
    const args = { ...composerArgs(answerCommandLocally), setActiveSuggestion: vi.fn() }
    const { result } = renderHook(() => useNativeChatPickerCommandDispatch(args))
    result.current({
      kind: 'command',
      id: 'command:context',
      name: 'context',
      token: '/context',
      skillCollision: false
    })
    expect(answerCommandLocally).toHaveBeenCalledWith('/context', 'claude-opus-5-5[1m]')
    expect(args.onSlashCommand).toHaveBeenCalledWith('/context', 'Context: 450k / 1m tokens (45%)')
    expect(mocks.sendNativeChatMessage).not.toHaveBeenCalled()
    expect(args.clearImageAttachments).not.toHaveBeenCalled()
    expect(args.setHistory).toHaveBeenCalled()
  })
})
