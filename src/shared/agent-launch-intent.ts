/**
 * What a caller asks for when it wants an agent running somewhere, independent of which surface
 * asked and of whether the answer turns out to be a structured session or a terminal.
 *
 * Every launch surface builds one of these: the renderer's agent tabs and workspace creates,
 * mobile's create sheet and new-tab button, `orchestration.workerStart`, and the CLI. The host
 * resolves it once — settings default plus per-launch feasibility from
 * `structured-native-chat-launch-route` — so no surface carries its own copy of that decision.
 *
 * The intent deliberately does NOT name a mode. A caller states what it wants to happen, not how
 * to deliver it; picking structured vs terminal is the host's job and is reported back in the
 * receipt rather than requested here.
 */

import type { TuiAgent } from './tui-agent'

/** How a launch's initial text reaches the agent. */
export type AgentLaunchPromptDelivery =
  /** Sent as the agent's first turn once it is ready. */
  | 'submit'
  /** Left unsent for the user to edit and send. Historically this forced a terminal, because a
   *  draft lived in the TUI's input and chat only mirrored it; a structured session accepts one
   *  directly, so it no longer decides the route. */
  | 'draft'

export type AgentLaunchPrompt = {
  text: string
  delivery: AgentLaunchPromptDelivery
}

/**
 * Where the agent lands.
 *
 * `create-worktree` is part of the intent rather than a separate call the caller makes first,
 * because the route cannot be settled before the workspace exists: `agentSession.createSupport`
 * can only answer for a workspace the host can resolve. Splitting the two is exactly what made
 * every new-worktree launch a terminal — the worktree was created agent-first, so the structured
 * branch below it was unreachable.
 */
export type AgentLaunchTarget =
  /** A workspace that already exists, addressed by any selector the runtime resolves. */
  | { kind: 'existing'; worktree: string }
  /** A worktree this launch creates. `create` is the `worktree.create` request minus its agent
   *  fields — the launch owns those, so a caller cannot set a startup agent behind the router. */
  | { kind: 'create-worktree'; create: Readonly<Record<string, unknown>> }

/** An existing terminal the caller wants reused rather than a fresh surface. Always resolves to a
 *  terminal agent: a running PTY keeps its execution transport. */
export type AgentLaunchReusedTerminal = { handle: string }

/**
 * The caller's name for this launch attempt, carried so a retry of an interrupted launch is
 * recognisable as the same attempt rather than a second one.
 *
 * The id's shape is the contract, not an opaque token: it is the shipped
 * `createStructuredAgentSessionOperationId` mint, whose leading 13 digits are the mint time. A host
 * reads that timestamp back to decide whether an attempt is still young enough to admit, so an id
 * in any other shape is unusable and is rejected at the wire rather than stored.
 *
 * Deliberately no caller-supplied fingerprint of the request: a digest a caller computes is a
 * channel for claiming two different launches are the same one, and it would freeze the host's
 * canonicalisation into the wire contract. The host derives its own from the params it parsed.
 */
export type AgentLaunchOperation = {
  /** `<13-digit ms timestamp>-<32 lowercase hex>`; see `createStructuredAgentSessionOperationId`. */
  id: string
}

export type AgentLaunchIntent = {
  agent: TuiAgent
  target: AgentLaunchTarget
  operation: AgentLaunchOperation
  prompt?: AgentLaunchPrompt
  /** Seeded launch options, narrowed by the host to what a structured create accepts. */
  sessionOptions?: Readonly<Record<string, unknown>>
  reuseTerminal?: AgentLaunchReusedTerminal
}

/** The surface the host actually created. */
export type AgentLaunchOutcome =
  | { kind: 'structured'; sessionId: string; handle: string }
  | { kind: 'terminal'; handle: string }

/** Whether this launch produced the agent or reported an earlier attempt's. Same vocabulary as
 *  `RuntimeCreateAgentSessionResult`, because it is the same distinction: a caller that retried
 *  must be able to tell "I started it" from "it was already started". */
export type AgentLaunchDisposition = 'created' | 'replayed'

/**
 * What became of the launch text.
 *
 * An enum rather than a boolean because "not delivered" and "handed to a surface that delivers it
 * out of band" are different answers, and a caller deciding whether to resend needs to tell them
 * apart. A receipt may under-claim — reporting a delivery it cannot vouch for as `not-delivered` is
 * a wasted resend, while over-claiming loses the text silently.
 */
export type AgentLaunchPromptOutcome =
  /** Committed to the session's transcript; `messageId` names it. */
  | 'journaled'
  /** Written to a PTY, whose consumption only the pane's owner observes. */
  | 'handed-to-terminal'
  /** Not delivered by this call; the caller still owns the text. */
  | 'not-delivered'

export type AgentLaunchPromptReceipt = {
  delivery: AgentLaunchPromptDelivery
  outcome: AgentLaunchPromptOutcome
  /** Set only for `journaled`, so a caller can locate the turn it asked for. */
  messageId?: string
}

export type AgentLaunchResult = {
  outcome: AgentLaunchOutcome
  /** The workspace the agent runs in, resolved or created. */
  worktreeId: string
  disposition: AgentLaunchDisposition
  /** Why the outcome is what it is — always populated, so a downgrade is never silent. */
  receipt: AgentLaunchModeReceipt
  prompt?: AgentLaunchPromptReceipt
  /** Something the user should know that did not stop the launch. Top level rather than on one
   *  outcome arm: a structured launch has the same need to say so. */
  warning?: string
}

export type AgentLaunchMode = 'structured' | 'terminal'

/** Why a launch ran in the mode it did. `user_default` is the preference being honoured; every
 *  other member is a reason the preference could not be applied to this launch. */
export type AgentLaunchModeReason =
  | 'user_default'
  | 'remote_execution_host'
  | 'reused_terminal'
  | 'agent_without_structured_session'
  | 'tui_launch_command'
  | 'structured_sessions_unavailable'
  | 'structured_support_unknown'
  | 'wsl_execution_runtime'
  | 'codex_on_windows'
  | 'structured_unsupported_on_host'

/** Restates `WorkerStartModeReceipt` in surface-neutral terms so orchestration's receipt and a
 *  mobile or renderer launch report the same vocabulary. */
export type AgentLaunchModeReceipt = {
  /** The mode the launch actually ran in. */
  mode: AgentLaunchMode
  /** The user's settings default for a new agent tab. */
  preferred: AgentLaunchMode
  reason: AgentLaunchModeReason
  /** One sentence, always present, so a fallback is never silent. */
  detail: string
}

export function agentLaunchTargetIsCreate(
  target: AgentLaunchTarget
): target is Extract<AgentLaunchTarget, { kind: 'create-worktree' }> {
  return target.kind === 'create-worktree'
}

/**
 * The create fields the launch owns rather than the caller.
 *
 * Every `startup*` field is placement: a caller that set one would route itself around the host's
 * mode decision. `clientMutationId` is the same argument for idempotency — `operation.id` names the
 * attempt now, and leaving a second key in the create payload would register one launch under two
 * independent dedupe keys.
 *
 * `createdWithAgent` is deliberately absent: it records which agent a workspace was made for, which
 * is provenance rather than placement, and the launch overwrites it with its own agent anyway.
 */
export const AGENT_LAUNCH_RESERVED_CREATE_FIELDS = [
  'startupAgent',
  'startupCommand',
  'startupPrompt',
  'startupDraft',
  'startupLaunchConfig',
  'startupEnv',
  'startupCommandDelivery',
  'clientMutationId'
] as const

/** Strips the reserved fields from a create payload. Callers migrating from `worktree.create` pass
 *  their existing params; this keeps a stale `startupAgent` from re-creating the agent-first path
 *  the router exists to replace. */
export function withoutReservedLaunchCreateFields(
  create: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const stripped: Record<string, unknown> = { ...create }
  for (const field of AGENT_LAUNCH_RESERVED_CREATE_FIELDS) {
    delete stripped[field]
  }
  return stripped
}
