/**
 * Issuing a mobile workspace create through `agent.launch` rather than `worktree.create`.
 *
 * `worktree.create` + `startupAgent` means "create the worktree agent-first": its startup terminal
 * IS the agent, so the structured branch below it is unreachable. That is why picking an agent on
 * the mobile create sheet always produced a PTY while the in-workspace "+" button produced a chat.
 * `agent.launch` carries the same create payload but lets the host settle the surface, so both
 * mobile entry points route the same way.
 *
 * The request is built from the caller's existing `worktree.create` params so the fallback path
 * stays byte-identical; the reserved agent fields are stripped here with the shared helper the
 * host applies anyway.
 */

import {
  withoutReservedAgentCreateFields,
  type AgentLaunchOutcome,
  type AgentLaunchResult
} from '../../../src/shared/agent-launch-intent'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import type { RpcSendParams } from '../transport/rpc-params-contract'
import type { WorkspaceCreateParams } from './workspace-create-params'

export type WorktreeCreateAgentLaunch = {
  agent: TuiAgent
  /** Resolved before the first create: an older host has no `agent.launch` at all. */
  supported: boolean | Promise<boolean>
}

/** `worktreeId` is tied to the shared contract so a change to it fails this reader's typecheck
 *  rather than silently passing a differently-typed field through. */
export type AgentLaunchCreateOutcome = {
  worktreeId: AgentLaunchResult['worktreeId']
  warning?: string
}

export function agentLaunchCreateParams(
  agent: TuiAgent,
  create: WorkspaceCreateParams
): RpcSendParams<'agent.launch'> {
  return {
    agent,
    target: { kind: 'create-worktree', create: withoutReservedAgentCreateFields(create) }
  }
}

/**
 * Reads the launch receipt.
 *
 * Deliberately mode-blind: whichever surface the host built, it published and activated that tab
 * before answering, so the create flow navigates to the workspace and the host's own active-tab
 * marking decides what opens. That is why nothing here branches on `outcome.kind` to pick a
 * destination — a create-time guess would just race the snapshot that already knows.
 */
export function readAgentLaunchCreateOutcome(result: unknown): AgentLaunchCreateOutcome | null {
  if (!result || typeof result !== 'object' || !('worktreeId' in result)) {
    return null
  }
  const worktreeId = result.worktreeId
  if (typeof worktreeId !== 'string' || !worktreeId.trim()) {
    return null
  }
  const warning = parseTerminalLaunchOutcome(
    'outcome' in result ? result.outcome : undefined
  )?.warning?.trim()
  return { worktreeId, ...(warning ? { warning } : {}) }
}

/**
 * The terminal outcome, narrowed to the fields this reader consumes. Taken from the shared union
 * rather than restated, so a change to the contract fails here instead of flowing through.
 *
 * `handle` is deliberately not required: nothing here reads it, and demanding it would drop the
 * warning off a reply that omitted it — a behaviour change smuggled in under a typing change.
 */
type TerminalLaunchOutcome = Pick<
  Extract<AgentLaunchOutcome, { kind: 'terminal' }>,
  'kind' | 'warning'
>

/**
 * Parses the launch outcome, which arrives as whatever the host sent.
 *
 * A terminal launch reports its startup failure here: the workspace exists, the agent did not
 * start (pty exhaustion). Dropping it is what lands the phone on an unexplained empty session.
 *
 * Parsed into a named type at this boundary rather than read off a loose `object`, and narrowed
 * rather than asserted — a reader that claims the contract's shape without checking it is how a
 * malformed reply reaches the UI as a TypeError instead of a message.
 */
function parseTerminalLaunchOutcome(outcome: unknown): TerminalLaunchOutcome | null {
  if (
    !outcome ||
    typeof outcome !== 'object' ||
    !('kind' in outcome) ||
    outcome.kind !== 'terminal'
  ) {
    return null
  }
  const warning =
    'warning' in outcome && typeof outcome.warning === 'string' ? outcome.warning : undefined
  return { kind: 'terminal', ...(warning === undefined ? {} : { warning }) }
}

/**
 * Whether the host rejected the method itself rather than the create.
 *
 * The `status.get` probe can be stale in one direction that matters: the host advertises
 * `agent.launch.v1` but has not yet recorded this client's own capability list, and then refuses
 * the call. Downgrading to `worktree.create` keeps that race from failing a create outright.
 */
export function isAgentLaunchUnsupportedRefusal(error: {
  code?: string
  message?: string
}): boolean {
  if (error.code === 'method_not_found' || error.code === 'forbidden') {
    return true
  }
  return (error.message ?? '').includes('agent_launch_unsupported')
}
