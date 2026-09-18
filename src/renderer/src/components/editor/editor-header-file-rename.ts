import { useCallback, useRef, useState } from 'react'
import type { RefCallback } from 'react'
import type { OpenFile } from '@/store/slices/editor'
import { useWorktreeById } from '@/store/selectors'
import { basename, dirname } from '@/lib/path'
import { renameFileOnDisk } from '@/lib/rename-file'
import { getUntitledFileRoot } from './untitled-file-rename-path'

type EditorHeaderFileRenameState = {
  canRename: boolean
  currentFileName: string
  currentBaseName: string
  pinnedExtension: string
  breadcrumbSegments: string[]
  isRenaming: boolean
  renameInputRef: RefCallback<HTMLInputElement>
  openRenameInput: () => void
  setRenameDraft: (value: string) => void
  commitRename: () => void
  cancelRename: () => void
}

// Breadcrumb for the morph strip: worktree name plus parent dirs, so the
// rename field keeps its location context without shifting header layout.
function getBreadcrumbSegments(relativePath: string, worktreePath: string | null): string[] {
  const segments: string[] = []
  if (worktreePath) {
    segments.push(basename(worktreePath))
  }
  if (relativePath) {
    for (const part of dirname(relativePath).split('/')) {
      if (part && part !== '.') {
        segments.push(part)
      }
    }
  }
  return segments
}

// A leading dot is part of a dotfile's name, not an extension — same split the
// hook uses on the current file name.
export function getTypedExtension(rawValue: string): string {
  const dotIndex = rawValue.lastIndexOf('.')
  return dotIndex > 0 ? rawValue.slice(dotIndex) : ''
}

// The morph input edits the basename while the extension stays pinned as a
// suffix, so a bare name gets the extension re-attached. A typed extension
// (same or different) is respected verbatim and the pinned suffix is hidden so
// the strip shows the name that will be committed; null means no-op.
export function resolveRenameTarget(
  rawValue: string,
  currentFileName: string,
  currentExtension: string
): string | null {
  if (!rawValue || rawValue === currentFileName) {
    return null
  }
  if (!currentExtension || getTypedExtension(rawValue)) {
    return rawValue
  }
  return `${rawValue}${currentExtension}`
}

export function useEditorHeaderFileRename(activeFile: OpenFile): EditorHeaderFileRenameState {
  const worktree = useWorktreeById(activeFile.worktreeId)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameFilePath, setRenameFilePath] = useState(activeFile.filePath)
  const renameInputElementRef = useRef<HTMLInputElement | null>(null)
  const renameFocusFrameRef = useRef<number | null>(null)
  // Why: the header renders one unkeyed path strip for every file, so a file
  // switch mid-rename would otherwise commit the typed name against the new path.
  if (renameFilePath !== activeFile.filePath) {
    setRenameFilePath(activeFile.filePath)
    setIsRenaming(false)
    setRenameDraft('')
  }
  const currentFileName = basename(activeFile.filePath)
  const lastDotIndex = currentFileName.lastIndexOf('.')
  const hasExtension = lastDotIndex > 0
  const currentBaseName = hasExtension ? currentFileName.slice(0, lastDotIndex) : currentFileName
  const currentExtension = hasExtension ? currentFileName.slice(lastDotIndex) : ''
  const pinnedExtension = getTypedExtension(renameDraft.trim()) ? '' : currentExtension
  const breadcrumbSegments = getBreadcrumbSegments(activeFile.relativePath, worktree?.path ?? null)
  // Why: read-only tabs (AI Vault View Log) are never renameable — rename would
  // rewrite the agent-owned artifact's backing path.
  const canRename =
    activeFile.mode === 'edit' &&
    !activeFile.diffSource &&
    !activeFile.conflict &&
    !activeFile.readOnly &&
    !isRenaming

  const openRenameInput = (): void => {
    if (!canRename) {
      return
    }
    setRenameDraft(currentBaseName)
    setIsRenaming(true)
  }

  const commitRename = (): void => {
    const input = renameInputElementRef.current
    if (!input) {
      setIsRenaming(false)
      return
    }
    const rawVal = input.value.trim()
    setIsRenaming(false)
    const newName = resolveRenameTarget(rawVal, currentFileName, currentExtension)
    if (!newName) {
      return
    }
    const worktreePath = getUntitledFileRoot(activeFile, worktree?.path ?? null)
    void renameFileOnDisk({
      oldPath: activeFile.filePath,
      newName,
      worktreeId: activeFile.worktreeId,
      worktreePath
    })
  }

  const cancelRename = (): void => {
    setIsRenaming(false)
  }

  const clearRenameFocusFrame = useCallback((): void => {
    if (renameFocusFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(renameFocusFrameRef.current)
    renameFocusFrameRef.current = null
  }, [])

  const renameInputRef = useCallback<RefCallback<HTMLInputElement>>(
    (el) => {
      renameInputElementRef.current = el
      clearRenameFocusFrame()
      if (!el || !isRenaming) {
        return
      }

      // Why: focus belongs to the rename input mount; the frame preserves the
      // previous timing so header layout settles before selecting text. The
      // input holds the basename with the extension pinned alongside, so
      // selecting all replaces the name without touching the suffix.
      renameFocusFrameRef.current = requestAnimationFrame(() => {
        renameFocusFrameRef.current = null
        if (renameInputElementRef.current !== el) {
          return
        }
        el.focus()
        el.select()
      })
    },
    [clearRenameFocusFrame, isRenaming]
  )

  return {
    canRename,
    currentFileName,
    currentBaseName,
    pinnedExtension,
    breadcrumbSegments,
    isRenaming,
    renameInputRef,
    openRenameInput,
    setRenameDraft,
    commitRename,
    cancelRename
  }
}
