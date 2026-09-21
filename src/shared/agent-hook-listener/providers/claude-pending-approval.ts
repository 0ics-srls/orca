import { createHash } from 'node:crypto'

/** What kind of evidence retires a pending prompt.
 *
 *  `completion` — Claude announces a call's `PreToolUse` BEFORE raising its `PermissionRequest`,
 *  so a `PreToolUse` is never proof that a pending approval was granted; only the call's own
 *  completion is newer evidence than the prompt.
 *  `any-tool-event` — an AskUserQuestion wait IS that call's `PreToolUse`, and answering it emits
 *  no hook of its own, so the agent announcing any further call proves it moved on. */
export type ClaudePendingApprovalRetirement = 'completion' | 'any-tool-event'

/** Which tool call a hook is about, from the fields every raising AND resolving event carries. */
export type ClaudeToolCallIdentity = {
  readonly toolName: string
  /** Digest of the FULL tool input. Absent when the payload carried no input at all. */
  readonly inputDigest?: string
}

/** One prompt Claude raised on a pane that has not been observed resolving. */
export type ClaudePendingApproval = ClaudeToolCallIdentity & {
  /** Subagent that owns the prompt; absent for the lead session. */
  readonly agentId?: string
  /** Only when the raising event carried one. `PermissionRequest` never does. */
  readonly toolUseId?: string
  readonly retiredBy: ClaudePendingApprovalRetirement
}

/** A tool call announced or completed on a pane, as the pending set reads it. */
export type ClaudeToolCallObservation = ClaudeToolCallIdentity & {
  readonly agentId?: string
  readonly toolUseId?: string
  /** True for `PostToolUse` / `PostToolUseFailure`. */
  readonly completesCall: boolean
}

/** Enough for any real parallel batch; a runaway producer sheds its oldest rather than growing. */
const MAX_CLAUDE_PENDING_APPROVALS = 8
const MAX_CALL_KEY_DEPTH = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalizeToolInput(value: unknown, depth: number): unknown {
  if (depth >= MAX_CALL_KEY_DEPTH) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeToolInput(entry, depth + 1))
  }
  if (!isRecord(value)) {
    return value
  }
  const canonical: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    canonical[key] = canonicalizeToolInput(value[key], depth + 1)
  }
  return canonical
}

/** Identity of a tool call from the fields every raising AND resolving hook carries.
 *
 *  Claude's `PermissionRequest` payload has no `tool_use_id` (measured on CLI 2.1.270; reported
 *  the same on 2.1.220/2.1.221), so the tool name plus the FULL tool input is the only pairing
 *  key that is always present. Orca's `toolInput` preview is not usable here — it is clipped at
 *  160 characters and absent for MCP/Task/TodoWrite, which would make siblings indistinguishable. */
export function claudeToolCallIdentity(
  toolName: unknown,
  toolInput: unknown
): ClaudeToolCallIdentity {
  const name = typeof toolName === 'string' ? toolName.trim() : ''
  if (toolInput === undefined) {
    return { toolName: name }
  }
  let serialized: string
  try {
    serialized = JSON.stringify(canonicalizeToolInput(toolInput, 0)) ?? '\u0000absent'
  } catch {
    // Why: an input this cannot serialize is no identity at all — degrade to the tool name.
    return { toolName: name }
  }
  return { toolName: name, inputDigest: createHash('sha256').update(serialized).digest('hex') }
}

/** Stable map key for the announced-call registry. */
export function claudeToolCallLookupKey(
  agentId: string | undefined,
  call: ClaudeToolCallIdentity
): string {
  return `${agentId ?? ''}\u0000${call.toolName}\u0000${call.inputDigest ?? ''}`
}

function sameCall(entry: ClaudeToolCallIdentity, observed: ClaudeToolCallIdentity): boolean {
  if (entry.toolName !== observed.toolName) {
    return false
  }
  // Why: one side never reported an input (a PostToolUse may carry only its tool_response), so the
  // tool name is the whole identity available. A conflicting tool_use_id still refuses above.
  if (entry.inputDigest === undefined || observed.inputDigest === undefined) {
    return true
  }
  return entry.inputDigest === observed.inputDigest
}

function sameOwner(entryAgentId: string | undefined, observedAgentId: string | undefined): boolean {
  return (entryAgentId ?? '') === (observedAgentId ?? '')
}

function retires(entry: ClaudePendingApproval, observed: ClaudeToolCallObservation): boolean {
  if (!sameOwner(entry.agentId, observed.agentId)) {
    return false
  }
  if (!observed.completesCall) {
    return entry.retiredBy === 'any-tool-event'
  }
  // Why: two ids are an exact answer, so a sibling completion can never stand in for the prompt.
  if (entry.toolUseId !== undefined && observed.toolUseId !== undefined) {
    return entry.toolUseId === observed.toolUseId
  }
  return sameCall(entry, observed)
}

function sameApproval(a: ClaudePendingApproval, b: ClaudePendingApproval): boolean {
  return (
    sameOwner(a.agentId, b.agentId) &&
    a.toolName === b.toolName &&
    a.inputDigest === b.inputDigest &&
    a.toolUseId === b.toolUseId &&
    a.retiredBy === b.retiredBy
  )
}

export function raiseClaudePendingApproval(
  pending: readonly ClaudePendingApproval[] | undefined,
  raised: ClaudePendingApproval
): readonly ClaudePendingApproval[] {
  const existing = pending ?? []
  // Why: hooks can be delivered twice; a redelivered prompt must not stack a second obligation.
  if (existing.some((entry) => sameApproval(entry, raised))) {
    return existing
  }
  const next = [...existing, raised]
  return next.length > MAX_CLAUDE_PENDING_APPROVALS
    ? next.slice(next.length - MAX_CLAUDE_PENDING_APPROVALS)
    : next
}

/** Retire at most one prompt — the oldest this observation answers for. */
export function retireClaudePendingApprovals(
  pending: readonly ClaudePendingApproval[] | undefined,
  observed: ClaudeToolCallObservation
): readonly ClaudePendingApproval[] {
  const existing = pending ?? []
  const index = existing.findIndex((entry) => retires(entry, observed))
  return index === -1 ? existing : [...existing.slice(0, index), ...existing.slice(index + 1)]
}

export function claudePendingApprovalOwnedBy(
  pending: readonly ClaudePendingApproval[] | undefined,
  ownsWait: (agentId: string) => boolean
): boolean {
  return (pending ?? []).some((entry) => entry.agentId !== undefined && ownsWait(entry.agentId))
}

/** Drop every prompt an agent owns, for the lifecycle events that end it outright. */
export function dropClaudePendingApprovalsOwnedBy(
  pending: readonly ClaudePendingApproval[] | undefined,
  ownsWait: (agentId: string) => boolean
): readonly ClaudePendingApproval[] {
  const existing = pending ?? []
  const remaining = existing.filter(
    (entry) => entry.agentId === undefined || !ownsWait(entry.agentId)
  )
  return remaining.length === existing.length ? existing : remaining
}

/** `tool_use_id` Claude announced for each distinct call of the current turn.
 *
 *  A `PermissionRequest` carries no id, so without this a prompt could only ever be matched by
 *  its call key — and a sibling completion of a byte-identical call would answer for it. Adopting
 *  the announced id makes a conflicting completion refusable. `null` records an AMBIGUOUS key
 *  (two announced calls, same tool and same input) where no id may be adopted, so ambiguity
 *  degrades to call-key matching instead of guessing an owner. */
export type ClaudeAnnouncedCalls = Readonly<Record<string, string | null>>

/** Enough for any real turn; a runaway producer sheds its oldest rather than growing. */
const MAX_ANNOUNCED_CALLS = 32

export function recordClaudeAnnouncedCall(
  announced: ClaudeAnnouncedCalls | undefined,
  key: string,
  toolUseId: string
): ClaudeAnnouncedCalls {
  const existing = announced ?? {}
  const recorded = existing[key]
  if (recorded === toolUseId || recorded === null) {
    return existing
  }
  const next: Record<string, string | null> = { ...existing }
  next[key] = recorded === undefined ? toolUseId : null
  const keys = Object.keys(next)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ANNOUNCED_CALLS))) {
    delete next[stale]
  }
  return next
}

export function claudeAnnouncedCallToolUseId(
  announced: ClaudeAnnouncedCalls | undefined,
  key: string
): string | undefined {
  const recorded = announced?.[key]
  return typeof recorded === 'string' ? recorded : undefined
}

/** What the previous lead-turn record carries into this event's approval fold. */
export type ClaudeApprovalCarryover = {
  readonly pendingApprovals?: readonly ClaudePendingApproval[]
  readonly announcedCalls?: ClaudeAnnouncedCalls
}

/** Everything one hook event says about the pane's outstanding prompts. */
export type ClaudeApprovalFold = {
  /** This event's tool call, when it is one. */
  readonly toolCall?: ClaudeToolCallObservation
  /** Per-call ids announced so far this turn, including this event's. */
  readonly announcedCalls?: ClaudeAnnouncedCalls
  /** Prompts still outstanding once this event's completion, if any, is applied. */
  readonly pendingAfterCall: readonly ClaudePendingApproval[]
  /** The prompt this event raises, when it is a waiting-inducing one. */
  readonly raisedApproval?: ClaudePendingApproval
}

/** Derive the pane's outstanding prompts from one hook event, with no latch behind them:
 *  a prompt exists because it was raised and has not been answered for, and nothing else. */
export function foldClaudeApprovalEvent(input: {
  carriedOver: ClaudeApprovalCarryover | undefined
  eventName: unknown
  agentId?: string
  toolUseId?: string
  toolName: unknown
  toolInput: unknown
  /** This event puts the pane in a human-input wait. */
  raisesWait: boolean
  /** That wait is an AskUserQuestion, which IS its call's PreToolUse rather than following it. */
  raisesQuestionWait: boolean
}): ClaudeApprovalFold {
  const { carriedOver, eventName, agentId, toolUseId } = input
  const call = claudeToolCallIdentity(input.toolName, input.toolInput)
  const completesCall = eventName === 'PostToolUse' || eventName === 'PostToolUseFailure'
  const toolCall =
    eventName === 'PreToolUse' || completesCall
      ? {
          ...call,
          ...(agentId !== undefined ? { agentId } : {}),
          ...(toolUseId !== undefined ? { toolUseId } : {}),
          completesCall
        }
      : undefined
  const lookupKey = claudeToolCallLookupKey(agentId, call)
  // Why: record what Claude announced for this call BEFORE the prompt that follows it, so a
  // permission request the CLI gives no `tool_use_id` can still adopt one and refuse a sibling.
  const announcedCalls =
    eventName === 'PreToolUse' && toolUseId !== undefined
      ? recordClaudeAnnouncedCall(carriedOver?.announcedCalls, lookupKey, toolUseId)
      : carriedOver?.announcedCalls
  const pendingBefore = carriedOver?.pendingApprovals ?? []
  const pendingAfterCall = toolCall
    ? retireClaudePendingApprovals(pendingBefore, toolCall)
    : pendingBefore
  if (!input.raisesWait) {
    return {
      ...(toolCall ? { toolCall } : {}),
      ...(announcedCalls ? { announcedCalls } : {}),
      pendingAfterCall
    }
  }
  const ownerToolUseId = toolUseId ?? claudeAnnouncedCallToolUseId(announcedCalls, lookupKey)
  return {
    ...(toolCall ? { toolCall } : {}),
    ...(announcedCalls ? { announcedCalls } : {}),
    pendingAfterCall,
    raisedApproval: {
      ...call,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(ownerToolUseId !== undefined ? { toolUseId: ownerToolUseId } : {}),
      retiredBy: input.raisesQuestionWait ? 'any-tool-event' : 'completion'
    }
  }
}
