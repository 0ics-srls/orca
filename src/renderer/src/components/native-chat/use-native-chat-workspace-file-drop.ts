import { useCallback, type DragEventHandler } from 'react'
import { useAppStore } from '@/store'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  getWorkspaceFileDragRejectionMessage,
  hasWorkspaceFileDragType,
  isResolvedWorkspaceFileDragExecutionHost,
  readWorkspaceFileDragPaths,
  readWorkspaceFileDragSource
} from '@/lib/workspace-file-drag'
import {
  resolveNativeChatAttachmentOwnerForWorktree,
  nativeChatWorktreeNotReadyNotice
} from './native-chat-attachment-upload'
import { findTerminalTabWorktreeId } from './native-chat-file-link'
import {
  nativeChatAttachmentOwnerUnchanged,
  nativeChatWorkspaceAttachmentMismatchNotice,
  type NativeChatResolvedPathOptions
} from './native-chat-resolved-path-ownership'

type WorkspaceFileDropHandlers = {
  onDragOverCapture: DragEventHandler<HTMLDivElement>
  onDropCapture: DragEventHandler<HTMLDivElement>
}

type Args = {
  attachResolvedPaths: (
    paths: string[],
    connectionId?: string | null,
    options?: NativeChatResolvedPathOptions
  ) => void
  disabled: boolean
  setNotice: (notice: string | null) => void
  structuredWorktreeId?: string
  terminalTabId: string
}

function stopWorkspaceFileDrop(event: React.DragEvent<HTMLDivElement>): void {
  event.preventDefault()
  event.stopPropagation()
  event.nativeEvent.stopImmediatePropagation()
}

function setCopyDropEffect(dataTransfer: DataTransfer): void {
  if (
    dataTransfer.effectAllowed === 'all' ||
    dataTransfer.effectAllowed === 'copy' ||
    dataTransfer.effectAllowed === 'copyLink' ||
    dataTransfer.effectAllowed === 'copyMove' ||
    dataTransfer.effectAllowed === 'uninitialized'
  ) {
    dataTransfer.dropEffect = 'copy'
  }
}

export function useNativeChatWorkspaceFileDrop({
  attachResolvedPaths,
  disabled,
  setNotice,
  structuredWorktreeId,
  terminalTabId
}: Args): WorkspaceFileDropHandlers {
  const onDragOverCapture = useCallback<DragEventHandler<HTMLDivElement>>(
    (event) => {
      if (!hasWorkspaceFileDragType(event.dataTransfer)) {
        return
      }
      stopWorkspaceFileDrop(event)
      if (!disabled) {
        setCopyDropEffect(event.dataTransfer)
      }
    },
    [disabled]
  )

  const onDropCapture = useCallback<DragEventHandler<HTMLDivElement>>(
    (event) => {
      if (!hasWorkspaceFileDragType(event.dataTransfer)) {
        return
      }
      stopWorkspaceFileDrop(event)
      if (disabled) {
        return
      }
      setCopyDropEffect(event.dataTransfer)

      const dragPaths = readWorkspaceFileDragPaths(event.dataTransfer)
      if (dragPaths.status === 'rejected') {
        setNotice(getWorkspaceFileDragRejectionMessage(dragPaths.reason))
        return
      }
      if (dragPaths.paths.length === 0) {
        return
      }

      const state = useAppStore.getState()
      const workspaceId =
        structuredWorktreeId ?? findTerminalTabWorktreeId(state.tabsByWorktree, terminalTabId)
      const source = readWorkspaceFileDragSource(event.dataTransfer)
      if (!workspaceId || !source || source.workspaceId !== workspaceId) {
        setNotice(nativeChatWorkspaceAttachmentMismatchNotice())
        return
      }
      const owner = resolveNativeChatAttachmentOwnerForWorktree(
        state,
        workspaceId,
        structuredWorktreeId ? undefined : terminalTabId
      )
      if (owner.kind === 'not-ready') {
        setNotice(nativeChatWorktreeNotReadyNotice())
        return
      }
      const targetExecutionHostId = getExecutionHostIdForWorktree(state, workspaceId)
      if (
        !isResolvedWorkspaceFileDragExecutionHost(targetExecutionHostId) ||
        source.executionHostId !== targetExecutionHostId
      ) {
        setNotice(nativeChatWorkspaceAttachmentMismatchNotice())
        return
      }

      const targetOwnerIsCurrent = (): boolean => {
        const currentState = useAppStore.getState()
        const currentWorkspaceId =
          structuredWorktreeId ??
          findTerminalTabWorktreeId(currentState.tabsByWorktree, terminalTabId)
        if (currentWorkspaceId !== source.workspaceId) {
          return false
        }
        const currentHostId = getExecutionHostIdForWorktree(currentState, currentWorkspaceId)
        const currentOwner = resolveNativeChatAttachmentOwnerForWorktree(
          currentState,
          currentWorkspaceId,
          structuredWorktreeId ? undefined : terminalTabId
        )
        return (
          isResolvedWorkspaceFileDragExecutionHost(currentHostId) &&
          currentHostId === source.executionHostId &&
          nativeChatAttachmentOwnerUnchanged(owner, currentOwner)
        )
      }

      attachResolvedPaths(dragPaths.paths, owner.kind === 'ssh' ? owner.connectionId : undefined, {
        targetOwnerIsCurrent
      })
    },
    [attachResolvedPaths, disabled, setNotice, structuredWorktreeId, terminalTabId]
  )

  return { onDragOverCapture, onDropCapture }
}
