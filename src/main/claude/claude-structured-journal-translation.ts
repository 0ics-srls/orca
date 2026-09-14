import type { AgentJournalItemIdentity } from '../../shared/agent-session-journal-types'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import type { AgentSessionDeltaCoalescerDeps } from '../native-chat/agent-session-wire/agent-session-delta-coalescer'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import {
  boundInlineText,
  DEFAULT_JOURNAL_PAYLOAD_LIMITS
} from '../native-chat/agent-session-journal/journal-payload-bounds'
import type { ClaudeStructuredSessionEvent } from './claude-structured-session-state'
import {
  claudeMessageBody,
  claudeMessageIdentity,
  claudeHasReplayContent,
  claudeOutputEnvelope,
  claudeStreamingMessageBody,
  claudeThinkingIdentity,
  claudeThinkingText,
  claudeToolBody,
  claudeToolIdentity,
  claudeToolResults,
  claudeToolUses,
  readClaudeMessageEnvelope,
  type ClaudeToolUse
} from './claude-structured-item-translation'
import type { ClaudePromptRegistry } from './claude-structured-prompt-replies'
import { appendClaudePromptJournalItems } from './claude-structured-prompt-journal'
import { claudeProviderFrameActivity } from '../native-chat/agent-session-wire/provider-frame-activity'
import {
  appendUnmodeledClaudeContent,
  claudeProviderFrameKind,
  claudeResultFailure,
  createClaudeProviderFrameFallback,
  isSettledClaudeResultKind
} from './claude-structured-provider-fallback'
import { taskFrameSentence } from './claude-background-task-frames'
import { ClaudeBackgroundTaskRows } from './claude-background-task-rows'
import { ClaudeForwardedToolRegistry } from './claude-forwarded-tool-registry'
import { ClaudeSubagentRoster } from './claude-subagent-roster'
import { createClaudeStreamedBlockRegistry } from './claude-streamed-block-identity'
import { createClaudeStreamedTextCheckpoints } from './claude-streamed-text-checkpoints'
import {
  claudeTurnEndForResult,
  claudeTurnLifecycleItem,
  type ClaudeCurrentTurn,
  type ClaudeTurnEnd
} from './claude-turn-lifecycle-item'

export type ClaudeJournalTranslatorDeps = {
  sink: StructuredAgentSessionEventSink
  bindPromptItemId?: (journalItemId: string, promptKey: string, questionId?: string) => void
  coalesceMs?: number
  schedule?: AgentSessionDeltaCoalescerDeps['schedule']
  fallbackIdPrefix?: string
}

export type ClaudeJournalTranslator = {
  handle: (event: ClaudeStructuredSessionEvent) => void
  flush: () => void
  /** Streamed blocks still awaiting a final frame. A settled turn leaves none. */
  readonly pendingStreamedBlocks: number
  dispose: () => void
}

export function createClaudeSessionJournalTranslator(
  sink: StructuredAgentSessionEventSink | undefined,
  prompts: ClaudePromptRegistry,
  fallbackIdPrefix: string
): ClaudeJournalTranslator | null {
  return sink
    ? createClaudeJournalTranslator({
        sink,
        fallbackIdPrefix,
        bindPromptItemId: (itemId, promptKey, questionId) =>
          prompts.bindJournalItemId(itemId, promptKey, questionId)
      })
    : null
}

export function createClaudeJournalTranslator(
  deps: ClaudeJournalTranslatorDeps
): ClaudeJournalTranslator {
  const tools = new Map<string, ClaudeToolUse>()
  const promptItems = new Map<string, AgentJournalItemIdentity[]>()
  const streamedBlocks = createClaudeStreamedBlockRegistry()
  let currentTurn: ClaudeCurrentTurn | null = null
  const groupKeyOf = (turn: ClaudeCurrentTurn | null): string | null =>
    turn ? `${turn.sessionId}:${turn.turnId}` : null
  const providerFallback = createClaudeProviderFrameFallback(
    deps.sink,
    deps.fallbackIdPrefix ?? 'acquisition'
  )
  const subagents = new ClaudeSubagentRoster({
    sink: deps.sink,
    currentGroupKey: () => groupKeyOf(currentTurn)
  })
  const forwardedTools = new ClaudeForwardedToolRegistry()
  const backgroundTasks = new ClaudeBackgroundTaskRows({
    sink: deps.sink,
    isForwardedParentTool: (toolUseId) => forwardedTools.has(toolUseId)
  })
  const streamedText = createClaudeStreamedTextCheckpoints({
    ...(deps.coalesceMs === undefined ? {} : { coalesceMs: deps.coalesceMs }),
    ...(deps.schedule ? { schedule: deps.schedule } : {}),
    persist: (identity, text) => {
      deps.sink.appendItem(identity, claudeStreamingMessageBody(text))
      deps.sink.publish()
    }
  })

  const publishLifecycle = (turn: ClaudeCurrentTurn, end?: ClaudeTurnEnd): void => {
    const item = claudeTurnLifecycleItem(turn, end)
    deps.sink.appendItem(item.identity, item.body, item.options)
    deps.sink.publish({ coalescingKey: item.publishCoalescingKey })
  }

  const publishActivity = (kind: string, payload: unknown): void => {
    if (!currentTurn) {
      return
    }
    const text = claudeProviderFrameActivity(kind, payload)
    if (text !== undefined) {
      deps.sink.setActivity?.(text ? { turnId: currentTurn.turnId, text } : null)
    }
  }

  const handleStream = (message: Record<string, unknown>): boolean => {
    const delta = streamedBlocks.observe(message)
    if (!delta) {
      return false
    }
    streamedText.append(delta.identity, delta.text)
    return true
  }

  const handleMessage = (
    message: Record<string, unknown>,
    startsTurn: boolean,
    observedAt: number
  ): boolean => {
    const envelope = readClaudeMessageEnvelope(message)
    if (!envelope) {
      return false
    }
    let changed = false
    if (envelope.parentToolUseId) {
      subagents.observeChildActivity(envelope.parentToolUseId)
    }
    const outputEnvelope = claudeOutputEnvelope(envelope)
    const body = claudeMessageBody(outputEnvelope)
    const identity =
      (body && envelope.role === 'assistant' ? streamedBlocks.reconcile(envelope) : null) ??
      claudeMessageIdentity(envelope)
    streamedText.forget(agentJournalItemKey(identity))
    if (body) {
      deps.sink.appendItem(identity, body)
      changed = true
    }
    for (const tool of claudeToolUses(outputEnvelope)) {
      tools.set(tool.id, tool)
      // Only a TOP-LEVEL call can be the parent of a top-level task row; a
      // sidechain's own tool ids never reach the transcript.
      if (!envelope.parentToolUseId) {
        forwardedTools.record(tool.id)
      }
      deps.sink.appendItem(
        claudeToolIdentity(envelope.sessionId, tool.id),
        claudeToolBody({ tool })
      )
      changed = true
    }
    for (const result of claudeToolResults(envelope)) {
      const tool = tools.get(result.toolUseId) ?? {
        id: result.toolUseId,
        name: 'tool',
        input: null
      }
      deps.sink.appendItem(
        claudeToolIdentity(envelope.sessionId, result.toolUseId),
        claudeToolBody({ tool, result })
      )
      subagents.observeToolResult(result.toolUseId, result.failed)
      tools.delete(result.toolUseId)
      changed = true
    }
    const thinking = claudeThinkingText(outputEnvelope)
    if (thinking) {
      deps.sink.appendItem(claudeThinkingIdentity(envelope.sessionId, envelope.uuid), {
        kind: 'message',
        role: 'reasoning',
        blocks: [
          { type: 'text', text: boundInlineText(thinking, DEFAULT_JOURNAL_PAYLOAD_LIMITS).text }
        ]
      })
      changed = true
    }
    changed = appendUnmodeledClaudeContent(providerFallback, outputEnvelope, message) || changed
    if (
      envelope.role === 'user' &&
      startsTurn &&
      claudeHasReplayContent(envelope) &&
      message.parent_tool_use_id === null
    ) {
      if (currentTurn) {
        subagents.settleTurn(groupKeyOf(currentTurn))
        publishLifecycle(currentTurn, { state: 'interrupted', completedAt: observedAt })
      }
      currentTurn = {
        sessionId: envelope.sessionId,
        turnId: envelope.uuid,
        startedAt: observedAt,
        userItemId: agentJournalItemKey(identity)
      }
      publishLifecycle(currentTurn)
      deps.sink.setActivity?.(null)
    }
    if (changed) {
      deps.sink.publish()
    }
    return true
  }

  const handlePrompt = (event: Extract<ClaudeStructuredSessionEvent, { type: 'prompt' }>): void => {
    const identities = appendClaudePromptJournalItems({
      event,
      sink: deps.sink,
      ...(deps.bindPromptItemId ? { bindPromptItemId: deps.bindPromptItemId } : {})
    })
    promptItems.set(event.prompt.promptKey, identities)
    deps.sink.publish()
  }

  return {
    handle: (event) => {
      if (event.type === 'ended') {
        streamedText.flush()
        subagents.settleSession()
        backgroundTasks.settleSession()
        if (currentTurn) {
          publishLifecycle(currentTurn, {
            state: 'interrupted',
            completedAt: event.observedAt ?? Date.now()
          })
          currentTurn = null
        }
        deps.sink.setActivity?.(null)
        return
      }
      if (event.type === 'message' && handleStream(event.message)) {
        return
      }
      streamedText.flush()
      if (event.type === 'prompt') {
        handlePrompt(event)
      } else if (event.type === 'prompt-cancelled') {
        for (const identity of promptItems.get(event.promptKey) ?? []) {
          deps.sink.appendTombstone(identity)
        }
        promptItems.delete(event.promptKey)
        deps.sink.publish()
      } else if (event.type === 'message' && event.message.type === 'result') {
        subagents.settleTurn(groupKeyOf(currentTurn))
        if (currentTurn) {
          publishLifecycle(
            currentTurn,
            claudeTurnEndForResult(event.message, event.observedAt ?? Date.now())
          )
          currentTurn = null
        }
        deps.sink.setActivity?.(null)
        streamedBlocks.clear()
        streamedText.settle()
        const kind = claudeProviderFrameKind(event.message)
        const failure = claudeResultFailure(event.message)
        if (failure || !isSettledClaudeResultKind(kind)) {
          providerFallback.append(kind, event.message, failure?.text)
        }
      } else if (event.type === 'message') {
        subagents.observeSystemFrame(event.message)
        const backgroundTaskCovered = backgroundTasks.observe(event.message)
        const kind = claudeProviderFrameKind(event.message)
        if (
          !handleMessage(event.message, event.startsTurn === true, event.observedAt ?? Date.now())
        ) {
          providerFallback.append(kind, event.message, taskFrameSentence(event.message), {
            coveredByTypedTranslator: backgroundTaskCovered
          })
        }
        publishActivity(kind, event.message)
      } else if (event.type === 'provider-frame') {
        providerFallback.append(event.kind, event.payload)
        publishActivity(event.kind, event.payload)
      }
    },
    flush: streamedText.flush,
    get pendingStreamedBlocks() {
      return streamedText.pending
    },
    dispose: () => {
      streamedText.dispose()
      tools.clear()
      promptItems.clear()
      streamedBlocks.clear()
      subagents.dispose()
      backgroundTasks.dispose()
      forwardedTools.clear()
    }
  }
}
