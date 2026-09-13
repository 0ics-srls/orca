import {
  normalizeAgentStatusPayload,
  type AgentCompletionOutcome,
  type ParsedAgentStatusPayload
} from '../../agent-status-types'
import { isAskUserQuestionTool } from '../../agent-question-answered-intent'
import { clearPaneTurnCacheState, type HookListenerState } from '../listener-state'
import { resolvePrompt, resolveToolState, stripGrokUserQueryWrapper } from '../prompt-fields'
import { extractToolFields, isNewTurnEvent } from '../provider-event-routing'
import { readString } from '../tool-input-preview'
import { isGrokEvent } from '../provider-event-names'
import {
  getGrokNotificationType,
  isGrokPermissionNotification,
  isGrokRoutinePermissionPromptNotification
} from './grok-tool-fields'

function aliasedField(
  payload: Record<string, unknown>,
  primary: string,
  alias: string
): { present: boolean; value?: unknown } {
  if (Object.hasOwn(payload, primary)) {
    return { present: true, value: payload[primary] }
  }
  if (Object.hasOwn(payload, alias)) {
    return { present: true, value: payload[alias] }
  }
  return { present: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function grokTerminalOutcome(eventName: unknown): AgentCompletionOutcome | undefined {
  if (isGrokEvent(eventName, 'stop_failure')) {
    return 'failed'
  }
  if (isGrokEvent(eventName, 'stop_cancelled')) {
    return 'cancelled'
  }
  if (isGrokEvent(eventName, 'session_end')) {
    return 'session-ended'
  }
  if (isGrokEvent(eventName, 'stop')) {
    return 'succeeded'
  }
  return undefined
}

function shouldAnnounceGrokTerminal(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): boolean {
  // Why: failures and cancellations carry no background inventory and must never be hidden.
  if (isGrokEvent(eventName, 'stop_failure', 'stop_cancelled')) {
    return true
  }
  const backgroundTasks = aliasedField(hookPayload, 'backgroundTasks', 'background_tasks')
  // Why: Grok's shutdown Stop omits this field; a present but unknown value fails open.
  if (!backgroundTasks.present) {
    return false
  }
  const stopHookActive = aliasedField(hookPayload, 'stopHookActive', 'stop_hook_active')
  if (stopHookActive.value === true) {
    return false
  }
  if (!Array.isArray(backgroundTasks.value)) {
    return true
  }
  return !backgroundTasks.value.some((task) => {
    if (!isRecord(task)) {
      return false
    }
    return (task.type === 'shell' || task.type === 'subagent') && task.status === 'running'
  })
}

export function normalizeGrokEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>,
  grokHome?: string
): ParsedAgentStatusPayload | null {
  if (isGrokEvent(eventName, 'session_start')) {
    // Why: SessionStart resets stale per-turn state but must not create a working row before any prompt/tool event.
    clearPaneTurnCacheState(state, paneKey)
    return null
  }

  const notificationMessage = readString(hookPayload, 'message')
  const notificationType = getGrokNotificationType(hookPayload)
  const notificationLevel = readString(hookPayload, 'level')
  const preToolName =
    readString(hookPayload, 'toolName') ??
    readString(hookPayload, 'tool_name') ??
    readString(hookPayload, 'name')
  // Why: Grok's ask_user_question is auto-allowed, so it fires PreToolUse while blocked on a human answer; map to waiting.
  const isUserInputPreTool =
    isGrokEvent(eventName, 'pre_tool_use') && isAskUserQuestionTool(preToolName)

  const terminalOutcome = grokTerminalOutcome(eventName)
  let stateName: 'working' | 'waiting' | 'done' | null = null
  if (
    isGrokEvent(eventName, 'user_prompt_submit', 'post_tool_use', 'post_tool_use_failure') ||
    (isGrokEvent(eventName, 'pre_tool_use') && !isUserInputPreTool)
  ) {
    stateName = 'working'
  } else if (isUserInputPreTool) {
    stateName = 'waiting'
  } else if (terminalOutcome) {
    stateName = 'done'
  } else if (
    isGrokEvent(eventName, 'notification') &&
    isGrokEvent(notificationType, 'idle_prompt', 'task_complete')
  ) {
    // Why: typed idle/background-task notices are not terminal or needs-input outcomes.
    return null
  } else if (
    isGrokEvent(eventName, 'notification') &&
    isGrokRoutinePermissionPromptNotification(
      notificationType,
      notificationMessage,
      notificationLevel
    )
  ) {
    return null
  } else if (
    isGrokEvent(eventName, 'notification') &&
    isGrokPermissionNotification(notificationMessage)
  ) {
    stateName = 'waiting'
  }
  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('grok', eventName, hookPayload, { grokHome }),
    { resetOnNewTurn: isNewTurnEvent('grok', eventName) }
  )

  // Why: Grok Notification.message is status UI text, not the prompt; '' preserves the cached UserPromptSubmit.
  const effectivePrompt = isGrokEvent(eventName, 'notification')
    ? ''
    : stripGrokUserQueryWrapper(promptText)

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, effectivePrompt, {
      resetOnNewTurn: isNewTurnEvent('grok', eventName)
    }),
    agentType: 'grok',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    lastAssistantMessageIsToolOutput: snapshot.lastAssistantMessageIsToolOutput,
    ...(terminalOutcome
      ? {
          completionOutcome: terminalOutcome,
          announceCompletion: shouldAnnounceGrokTerminal(eventName, hookPayload),
          ...(terminalOutcome === 'cancelled' ? { interrupted: true } : {}),
          ...(terminalOutcome === 'session-ended' ? { sessionBoundary: true } : {})
        }
      : {})
  })
}
