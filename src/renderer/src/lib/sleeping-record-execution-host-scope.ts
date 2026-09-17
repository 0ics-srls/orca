import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import {
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import {
  getExecutionHostIdForWorktree,
  type WorktreeRuntimeOwnerState
} from './worktree-runtime-owner'

/**
 * Does this record's `--resume` locator belong to a different machine than the one the resume would
 * run on?
 *
 * A provider session id names a transcript in one machine's agent state directory, but nothing
 * else in the resume path is host-scoped: `worktreeId` is `repoId::path` with no host component
 * (shared/worktree/host-qualified-identity.ts), sleeping records are `'sleepingAgentKeyed'` so the
 * boot-time host-contention parking never arbitrates them and every partition's records merge into
 * one map, and `launchSleepingAgentSession` resolves its launch target from the *current* catalog.
 * A record captured on host A therefore reaches a launch on host B, which answers
 * `No conversation found with session ID`.
 *
 * Deliberately fails open. It reports only a positively-known disagreement about the machine,
 * because the alternative — refusing whenever the hosts cannot be compared — would strand every
 * legitimate resume whose capture predates the stamp:
 *
 *  - `undefined` is "never stamped", not "local" (#9030 leaves SSH orphans unstamped).
 *  - `null` is "local **or** paired runtime": a `remote:<env>@@<handle>` PTY is stamped null too
 *    (agent-status-connection-ownership.ts), so null cannot rule a runtime host out — only an
 *    `ssh:` one, which is unambiguously another machine.
 *  - A current host of `runtime:*` is no evidence either way, because a paired client relabels its
 *    host's workspaces — including that host's own SSH ones — into its runtime namespace.
 */
export function agentResumeOriginNamesAnotherExecutionHost(
  originConnectionId: string | null | undefined,
  currentExecutionHostId: ExecutionHostId | null | undefined
): boolean {
  if (originConnectionId === undefined) {
    return false
  }
  const originTargetId = originConnectionId === null ? null : originConnectionId.trim()
  if (originTargetId === '') {
    return false
  }
  const currentHost = parseExecutionHostId(currentExecutionHostId)
  if (!currentHost || currentHost.kind === 'runtime') {
    return false
  }
  if (currentHost.kind === 'ssh') {
    return originTargetId === null || toSshExecutionHostId(originTargetId) !== currentHost.id
  }
  return originTargetId !== null
}

/** The worktree-scoped form the activation sweep asks, resolving the host from the catalog. */
export function sleepingRecordNamesAnotherExecutionHost(
  record: SleepingAgentSessionRecord,
  state: WorktreeRuntimeOwnerState
): boolean {
  return agentResumeOriginNamesAnotherExecutionHost(
    record.connectionId,
    getExecutionHostIdForWorktree(state, record.worktreeId)
  )
}
