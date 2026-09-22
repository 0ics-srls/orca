import type { ParsedAgentStatusPayload } from '../../shared/agent-status-types'
import {
  detectTerminalWaitBlockedReason,
  isKnownReadyPromptPreview
} from './terminal-wait-detection'

const MUSE_WORKING_LABEL_RE = /\b(running|cancelling|reading result)\b/

export type MuseTerminalActivity = 'ready' | 'working' | 'waiting'

type MuseActivityMemory = {
  activity: MuseTerminalActivity
  seenWorking: boolean
}

const memoryByPtyId = new Map<string, MuseActivityMemory>()

/** What a Muse pane is doing, from its terminal text. Null when the text is not Muse. */
export function classifyMuseTerminalActivity(text: string): MuseTerminalActivity | null {
  const normalized = text.toLowerCase()
  const blocked = detectTerminalWaitBlockedReason(text)
  const ready = isKnownReadyPromptPreview(text)
  const museTrust =
    normalized.includes('do you trust this workspace') && normalized.includes('trust and continue')
  const museApproval =
    normalized.includes('allow once') &&
    normalized.includes('reject once') &&
    normalized.includes('allow for this session') &&
    normalized.includes('block for this session')
  const museQuestion =
    normalized.includes('request user input') && normalized.includes('enter to select')
  const looksLikeMuse =
    normalized.includes('muse code') || museTrust || museApproval || museQuestion
  if (!looksLikeMuse) {
    return null
  }
  if (
    !ready &&
    (blocked === 'agent-trust-workspace' ||
      blocked === 'agent-approval-prompt' ||
      blocked === 'agent-interactive-prompt')
  ) {
    return 'waiting'
  }
  if (ready) {
    return 'ready'
  }
  if (MUSE_WORKING_LABEL_RE.test(normalized)) {
    return 'working'
  }
  return null
}

export function clearMuseTerminalActivity(ptyId: string): void {
  memoryByPtyId.delete(ptyId)
}

/**
 * The next status-store write for this pane, or null when nothing changed.
 * A ready composer after real work is a finished turn. A ready composer after
 * only a question is session setup, not a completed task.
 */
export function nextMuseTerminalStatus(
  ptyId: string,
  text: string
): ParsedAgentStatusPayload | null {
  const next = classifyMuseTerminalActivity(text)
  if (next === null) {
    return null
  }
  const stored = memoryByPtyId.get(ptyId)
  const previous = stored?.activity ?? null
  if (stored && stored.activity === next) {
    return null
  }
  const memory: MuseActivityMemory = stored ?? { activity: next, seenWorking: false }
  if (next === 'working') {
    memory.seenWorking = true
  }
  memory.activity = next
  memoryByPtyId.set(ptyId, memory)
  if (next === 'waiting') {
    return { state: 'waiting', prompt: 'Muse is waiting for you', agentType: 'muse' }
  }
  if (next === 'working') {
    return { state: 'working', prompt: 'Muse is working', agentType: 'muse' }
  }
  if (
    next === 'ready' &&
    memory.seenWorking &&
    (previous === 'working' || previous === 'waiting')
  ) {
    memory.seenWorking = false
    memoryByPtyId.set(ptyId, memory)
    return { state: 'done', prompt: 'Muse is ready', agentType: 'muse' }
  }
  if (next === 'ready' && (previous === 'waiting' || previous === null)) {
    return {
      state: 'done',
      prompt: 'Muse is ready',
      agentType: 'muse',
      sessionBoundary: true
    }
  }
  return null
}
