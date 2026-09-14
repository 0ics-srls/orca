import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import {
  rpcUncheckedMemberReader,
  rpcUncheckedPayloadReader
} from '../transport/rpc-reader-payload'

// What the host screen reads to label its rows and to mirror the desktop's workspace view store.
// Every read here is decorative: a refusal leaves the screen on what it already has and the next
// refresh retries, so all of them skip rather than throw.

export const hostRepoCatalogRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'repo.host-catalog-or-skip',
    method: 'repo.list',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('repo-catalog')
  })
)

/** Row labels for a catalog that spans hosts. Absent on a host that predates the method. */
export const hostSshTargetSummariesRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'ssh.host-target-summaries-or-skip',
    method: 'ssh.listTargetSummaries',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('ssh-target-summaries')
  })
)

export const hostPlatformRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'host.platform-or-skip',
    method: 'host.platform',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('host-platform')
  })
)

/**
 * The desktop's shared workspace view settings, a third family on ui.get.
 *
 * It keeps the Tasks screen's property-read throw on a null result — the screen's own try/catch is
 * what that throw has always landed in — where the New Workspace drawer's reader degrades instead.
 */
export const hostViewSettingsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'ui.host-view-settings-or-skip',
    method: 'ui.get',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedMemberReader('ui-view-settings', 'ui')
  })
)

/** Patching the same store. Best-effort: the local state already moved, and no reply is read. */
export const hostViewSettingsWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'ui.set-host-view-settings-or-skip',
    method: 'ui.set',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('ui-view-settings-written')
  })
)

/** What a host-screen read sends with, named from an operation so no module names the raw port. */
export type MobileHostScreenRpcSender = Parameters<typeof hostRepoCatalogRead.request>[0]
