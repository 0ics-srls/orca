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
  type AgentLaunchResult
} from '../../../src/shared/agent-launch-intent'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import type { RpcSendParams } from '../transport/rpc-params-contract'
import type { WorkspaceCreateParams } from './workspace-create-params'

/** What this host's `agent.launch` can do, in the `| false` shape `worktree.create`'s own
 *  idempotency probe already uses: `false` is an older host with no `agent.launch` at all. */
export type AgentLaunchSupport = {
  /** The host admits a launch through the durable operation ledger, so a caller that names its
   *  launch with `operationId` gets exactly one execution and the recorded answer on every replay.
   *  An older host strips the field as an unknown key and launches again, with no error. */
  replay: boolean
}

export type WorktreeCreateAgentLaunch = {
  agent: TuiAgent
  /** Resolved before the first create: an older host has no `agent.launch` at all. */
  supported: AgentLaunchSupport | false | Promise<AgentLaunchSupport | false>
}

/** `worktreeId` is tied to the shared contract so a change to it fails this reader's typecheck
 *  rather than silently passing a differently-typed field through. */
export type AgentLaunchCreateOutcome = {
  worktreeId: AgentLaunchResult['worktreeId']
  warning?: string
}

export function agentLaunchCreateParams(
  agent: TuiAgent,
  create: WorkspaceCreateParams,
  operationId?: string | null
): RpcSendParams<'agent.launch'> {
  return {
    agent,
    ...(operationId ? { operationId } : {}),
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
  // v2 guarantees that an incomplete create is reported at the top level, the same place
  // `worktree.create` puts it, so nothing here branches on which surface the host built.
  const warning = readTrimmedWarning(result)
  return { worktreeId, ...(warning ? { warning } : {}) }
}

function readTrimmedWarning(source: unknown): string {
  if (!source || typeof source !== 'object' || !('warning' in source)) {
    return ''
  }
  return typeof source.warning === 'string' ? source.warning.trim() : ''
}

/**
 * Whether the host rejected the method itself rather than the create.
 *
 * The `status.get` probe can be stale in one direction that matters: the host advertises
 * `agent.launch.v2` but has not yet recorded this client's own capability list, and then refuses
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

/**
 * The ledger declined to record the operation id. Admission runs ahead of resolving the caller's
 * target and ahead of every effect, so a refusal here proves nothing was launched — a full or
 * unreadable ledger must not be able to fail a create the host would otherwise have performed.
 */
const UNADMITTED_LAUNCH_OPERATION_CODES = new Set([
  'agent_session_operation_invalid',
  'agent_session_operation_expired',
  'agent_session_operation_capacity'
])

/**
 * What the host said about the operation *id*, as distinct from what it said about the launch.
 *
 * Classified on the code with a message fallback because the launch handler raises its refusals as
 * the thrown code — `mapRuntimeError` then answers with that same string in both fields — and a
 * relay in between may only preserve one of them. `agent_session_operation_conflict` is deliberately
 * absent: it means a row under this id disagrees about what the launch does, which can only be a
 * client that reused one id across two payloads, and papering over it would hide that bug forever.
 */
export function classifyAgentLaunchOperationRefusal(error: {
  code?: string
  message?: string
}): 'unadmitted' | 'unknown' | null {
  const message = error.message ?? ''
  if (
    error.code === 'agent_session_operation_unknown' ||
    message.includes('agent_session_operation_unknown')
  ) {
    // The effect may have happened. The same id may be re-sent; a fresh one is a second operation.
    return 'unknown'
  }
  if (
    (error.code && UNADMITTED_LAUNCH_OPERATION_CODES.has(error.code)) ||
    [...UNADMITTED_LAUNCH_OPERATION_CODES].some((code) => message.includes(code))
  ) {
    return 'unadmitted'
  }
  return null
}
