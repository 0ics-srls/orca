import type { GitDiffResult } from '../../../../shared/git-diff-compare-types'

/**
 * Thrown when a worktree's host owner is not yet known (the backing repo has
 * not hydrated). The retry gate treats this as transient so the read recovers
 * once the SSH connection finishes establishing, instead of latching a local
 * "access denied" for a remote path (#6648).
 */
export const WORKTREE_OWNER_NOT_READY_ERROR =
  'Connecting to the remote host… retrying once the workspace is ready.'

/**
 * Terminal message shown once the owner-not-ready retry budget is exhausted —
 * the remote host never finished connecting. Truthful (no longer claims it is
 * still retrying) and points the user at the Retry button, which starts a fresh
 * budget (#6648).
 */
export const WORKTREE_OWNER_UNREACHABLE_ERROR =
  "Couldn't reach the remote host. Check the connection, then retry."

/**
 * Machine code the runtime host returns when its worktree resolver cannot place
 * the file's workspace. It is UNKNOWN, not absence: the same code covers a deleted
 * worktree and a cold or failing scan (see remote-browser-stream-errors.ts), and
 * the file-read path has no definitive "gone" answer. The retry gate bounds it,
 * then swaps in the terminal message below — never an automatic close (#21041).
 */
export const WORKTREE_HOST_SELECTOR_NOT_FOUND_CODE = 'selector_not_found'

/**
 * Client-side sentinel stored on `loadErrorCode` once the selector-not-found retry
 * budget is spent. The comparison key is deliberately not the display text, so
 * localizing the message can never break the terminal-state check. Truthful about
 * what is known (the host could not resolve the workspace) and what is not (whether
 * it still exists); Retry starts a fresh budget, Close is the user's call so an
 * unsaved draft is never discarded on the host's behalf (#21041).
 */
export const WORKTREE_HOST_UNRESOLVED_CODE = 'worktree_host_unresolved'

/** English fallback for `loadError` alongside the code above; the error view localizes it by code. */
export const WORKTREE_HOST_UNRESOLVED_ERROR =
  "The host couldn't find this file's workspace. It may have been removed, or the host may still be scanning. Retry, or close the tab."

export type FileContent = {
  content: string
  isBinary: boolean
  isImage?: boolean
  mimeType?: string
  fileIdentity?: string
  loadError?: string
  /** Machine code from a runtime RPC failure; `loadError` alone may be prose (#21041). */
  loadErrorCode?: string
  /** Superseded by an external change; still rendered until the lazy reload lands. */
  isStale?: boolean
}

export type DiffContent = GitDiffResult & {
  /** Superseded by an external change; still rendered until the lazy reload lands. */
  isStale?: boolean
}

export type InFlightContentRead<T> = {
  externalEventGeneration?: number
  promise: Promise<T>
}
