import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import {
  rpcUncheckedMemberReader,
  rpcUncheckedPayloadReader
} from '../transport/rpc-reader-payload'

// What the session screen reads: the terminal inventory, the repo list two screens resolve a
// workspace's connection through, the session tab snapshot, and the quick-command list.

/**
 * The terminal inventory. A refused list leaves the strip exactly as it was — the screen treats it
 * as "no news", not as an empty host — which is what the skip policy says and what the throwing
 * policies would get wrong.
 */
export const sessionTerminalListRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.list',
    method: 'terminal.list',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('terminal-inventory')
  })
)

export type MobileRuntimeRepoSummary = { id: string; connectionId?: string | null }

const repoListReader = rpcUncheckedMemberReader('runtime-repo-list', 'repos')

/**
 * The repo list, read for one workspace's connection id. Two call sites want it and disagree about
 * a refusal, so each declares its own operation over the same reader rather than sharing a policy:
 * the new-tab agent loader has nothing to show without it and raises the host's message, while the
 * native-chat readability probe answers "not readable" and lets the screen render.
 */
export const newTabRepoListRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'repo.list-for-new-tab',
    method: 'repo.list',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: repoListReader
  })
)

export const nativeChatRepoListRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'repo.list-or-unreadable',
    method: 'repo.list',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: repoListReader
  })
)

/**
 * The agents a host reports for a workspace. Both the local and the remote probe read the payload
 * as the list it is, and the loader raises the host's message when either refuses.
 *
 * Separate from the task drawer's readers on the same two methods, which skip: there detection is
 * advisory and an empty set is a fine answer, where this loader gates a tab the user is opening and
 * has to say why no agent came back. Different acceptance, so two operations.
 */
export const preflightDetectAgentsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'preflight.detect-agents',
    method: 'preflight.detectAgents',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('detected-agents')
  })
)

export const preflightDetectRemoteAgentsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'preflight.detect-remote-agents',
    method: 'preflight.detectRemoteAgents',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('detected-agents')
  })
)

/**
 * The session tab snapshot the reconciliation controller polls. Its own generation, barrier and
 * application-revision guards decide whether a reply may be applied, all of which run before the
 * payload is read, so the controller keeps the raw reply and reports the refusal to its owner.
 */
export const sessionTabsListRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'session.tabs-list',
    method: 'session.tabs.list',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('session-tabs-snapshot')
  })
)

/**
 * The two ways native chat gets workspace paths. Both project the same `files[].relativePath` list,
 * and both refuse by leaving the suggestion list alone — the search's `method_not_found` is read
 * raw beforehand, because that code is what makes the composer fall back to the full inventory.
 */
export const nativeChatFileSearchRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.search-paths-or-skip',
    method: 'files.searchPaths',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedMemberReader('workspace-files', 'files')
  })
)

export const nativeChatFileInventoryRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.list-or-skip',
    method: 'files.list',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedMemberReader('workspace-files', 'files')
  })
)

const quickCommandsReader = rpcUncheckedPayloadReader('terminal-quick-commands')

/**
 * The quick-command list, read the same way on load and on save: the host re-normalizes and returns
 * the canonical list, and a payload the parser rejects reads as null so neither leg can adopt `[]`
 * and erase commands that still exist on the host.
 */
export const quickCommandsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'settings.quick-commands-read',
    method: 'settings.getTerminalQuickCommands',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: quickCommandsReader
  })
)

export const quickCommandsWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'settings.quick-commands-write',
    method: 'settings.updateTerminalQuickCommands',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: quickCommandsReader
  })
)
