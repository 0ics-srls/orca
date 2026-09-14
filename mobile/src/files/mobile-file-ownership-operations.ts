import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import {
  rpcUncheckedMemberReader,
  rpcUncheckedPayloadReader
} from '../transport/rpc-reader-payload'

// The three reads that pin which execution host owns a workspace before a file mutation is sent.
// All three share one acceptance because the capture is all-or-nothing: any refusal aborts the
// mutation with the host's own message rather than letting a write land on the wrong host.

/**
 * status.get read for the file-mutation capability gate, a third policy on this method alongside
 * `status.task-runtime` and `status.create-capabilities-or-skip` in the tasks domain. It matches
 * the first exactly; it stays a family of its own because a refused status here blocks a write,
 * and merging the two would tie a files-domain failure to a Tasks-screen decision.
 */
export const fileOwnershipRuntimeStatusRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'status.file-mutation-ownership',
    method: 'status.get',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('runtime-status')
  })
)

/** The workspace row the mutation targets. A null result throws where `result.worktree` did. */
export const fileOwnershipWorktreeRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'worktree.file-mutation-owner',
    method: 'worktree.show',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedMemberReader('worktree-summary', 'worktree')
  })
)

/** The SSH connection generation the mutation is expected to still be running on. */
export const fileOwnershipSshStateRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'ssh.file-mutation-owner-state',
    method: 'ssh.getState',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedMemberReader('ssh-connection-state', 'state')
  })
)

/** What an ownership capture sends with, named from an operation so no module names the raw port. */
export type MobileFileOwnershipRpcSender = Parameters<
  typeof fileOwnershipRuntimeStatusRead.request
>[0]
