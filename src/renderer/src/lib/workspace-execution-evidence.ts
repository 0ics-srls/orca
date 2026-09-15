import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import {
  resolveWorkspaceTerminalHostAuthority,
  type WorkspaceTerminalHostAuthorityState
} from './workspace-terminal-host-authority'

export type WorkspaceExecutionEvidence = 'live' | 'unverifiable' | 'exited'

export function resolveWorkspaceExecutionEvidence(
  state: WorkspaceTerminalHostAuthorityState,
  workspaceKey: string,
  executionHostId: ExecutionHostId,
  hostAbsenceConfirmed = false
): WorkspaceExecutionEvidence {
  const authority = resolveWorkspaceTerminalHostAuthority(state, workspaceKey)
  if (authority !== 'none') {
    return authority
  }
  const host = parseExecutionHostId(executionHostId)
  if (!host || host.kind === 'local') {
    return 'exited'
  }
  if (host.kind === 'runtime') {
    return 'unverifiable'
  }
  if (parseWorkspaceKey(workspaceKey)?.type === 'folder') {
    // SSH snapshots replace git-worktree rows only; a folder needs its own host-scoped census.
    return hostAbsenceConfirmed ? 'exited' : 'unverifiable'
  }
  const syncStatus = state.remoteWorkspaceSyncStatusByTargetId?.[host.targetId]
  return state.remoteWorkspaceHydratedTargetIds?.has(host.targetId) &&
    syncStatus?.phase === 'synced'
    ? 'exited'
    : 'unverifiable'
}
