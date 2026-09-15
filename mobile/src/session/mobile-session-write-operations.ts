import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import {
  rpcReadUnchecked,
  rpcUncheckedMemberReader,
  rpcUncheckedPayloadReader
} from '../transport/rpc-reader-payload'
import { isTerminalSendResultAccepted } from '../terminal/terminal-send-rpc-response'

// The session screen's writes: terminal input from native chat and the image surfaces, the tab
// strip's rename/close/activate, the worktree-stored review notes, and the markdown tab save.
// The `subscribe` and `sendUnsubscribe` ports these files sit next to are a separate boundary and
// are untouched here.

/**
 * A terminal write whose whole meaning is whether the runtime took the bytes. Native chat, the two
 * image paste paths and the stop key all read exactly this and treat a refusal, a non-object result
 * and an unaccepted one as the same "not delivered" — which is what `object-result-or-null` says,
 * and the only policy that turns an unreadable result into a verdict instead of a throw.
 *
 * Separate from `terminalInputSend` despite the identical policy and reader: that family is the
 * query-reply responder and the live accessory, and these callers differ in what a *lost* reply
 * means. Here a drop is delivery-unknown and must not be retried, so the two keep their own names
 * and their own recorded families rather than sharing one.
 */
export const nativeChatTerminalWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.native-chat-write',
    method: 'terminal.send',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: (raw) => rpcReadUnchecked('terminal-send-accepted', isTerminalSendResultAccepted(raw))
  })
)

/** Renaming a terminal. The reply body is unread: only acceptance decides whether the strip keeps
 *  the new title, and a refusal leaves the server title to the next refresh. */
export const sessionTerminalRename = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.rename',
    method: 'terminal.rename',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('terminal-renamed')
  })
)

/** Closing a terminal. Same skip policy for the same reason: a refused close must not prune the
 *  local list, because the pane is still there. */
export const sessionTerminalClose = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.close',
    method: 'terminal.close',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('terminal-closed')
  })
)

/** Closing a session tab, with the same accepted-or-leave-it-alone rule as the two above. */
export const sessionTabClose = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'session.tabs-close',
    method: 'session.tabs.close',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('session-tab-closed')
  })
)

/**
 * Focusing a terminal and activating a session tab. Both are sent through the cutover retry, which
 * logs the envelope's own `ok` and `error.code` and hands the raw reply back to its caller, so
 * neither is interpreted here — the acceptance is declared for the callers that eventually read a
 * verdict rather than the diagnostics.
 */
export const sessionTerminalFocus = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.focus',
    method: 'terminal.focus',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('terminal-focused')
  })
)

export const sessionTabActivate = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'session.tabs-activate',
    method: 'session.tabs.activate',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('session-tab-activated')
  })
)

/**
 * Writing the review notes and the per-file review state onto the worktree record. Both call sites
 * raise the host's message on a refusal and roll their optimistic list back, so the message has to
 * survive; the reply body is never read.
 */
export const sessionWorktreeNotesWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'worktree.set-review-notes',
    method: 'worktree.set',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('worktree-notes-written')
  })
)

/**
 * The review notes as they sit on the worktree record. `worktree.show` already has two readers —
 * the summary's `{ baseRef, linkedPR }` and the review screen's `{ diffComments, mobileDiffReview }`
 * — and this is a third, because the session screen reads the raw `worktree` member and normalizes
 * `diffComments` against the worktree id it is showing. The review screen's reader drops that
 * member's siblings, and the summary reader drops the notes entirely.
 */
export const sessionWorktreeNotesRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'worktree.show-review-notes',
    method: 'worktree.show',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedMemberReader('worktree-review-notes', 'worktree')
  })
)

/**
 * A markdown tab's document. The refusal is read raw before interpretation, because a headless host
 * answers `renderer_unavailable` and the screen falls back to the file on disk — a code no
 * acceptance policy carries.
 */
export const markdownTabRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'markdown.read-tab',
    method: 'markdown.readTab',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('markdown-tab-doc')
  })
)

/** The save leg. Its reply is the canonical document, and a refusal is shown on the tab. */
export const markdownTabSave = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'markdown.save-tab',
    method: 'markdown.saveTab',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('markdown-tab-doc')
  })
)
