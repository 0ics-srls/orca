import { useAppStore } from '@/store'
import { getExecutionHostIdForWorktree } from './worktree-runtime-owner'
import {
  isResolvedWorkspaceFileDragExecutionHost,
  writeWorkspaceFileDragSource
} from './workspace-file-drag'

export function writeWorkspaceFileDragSourceForWorkspace(
  dataTransfer: Pick<DataTransfer, 'setData'>,
  workspaceId: string
): void {
  const executionHostId = getExecutionHostIdForWorktree(useAppStore.getState(), workspaceId)
  if (!isResolvedWorkspaceFileDragExecutionHost(executionHostId)) {
    return
  }
  writeWorkspaceFileDragSource(dataTransfer, { executionHostId, workspaceId })
}
