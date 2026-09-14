import type { Repo } from '../../../shared/repo-types'
import {
  findFolderWorkspaceCandidateRepos,
  resolveFolderWorkspaceHost,
  type FolderWorkspaceHostState
} from '../../../shared/folder-workspace-execution-host'

export function getFolderWorkspaceCandidateRepos(
  state: FolderWorkspaceHostState,
  folderWorkspaceId: string
): Repo[] {
  return findFolderWorkspaceCandidateRepos(state, folderWorkspaceId)
}

/** Legacy tri-state view of the shared resolution: `undefined` = gone or ambiguous. */
export function getFolderWorkspaceConnectionId(
  state: FolderWorkspaceHostState,
  folderWorkspaceId: string
): string | null | undefined {
  const host = resolveFolderWorkspaceHost(state, folderWorkspaceId)
  if (host.kind === 'ssh') {
    return host.targetId
  }
  return host.kind === 'local' ? null : undefined
}
