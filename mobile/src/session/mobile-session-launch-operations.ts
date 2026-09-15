import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'
import { rpcReadUnchecked, rpcUncheckedPayloadReader } from '../transport/rpc-reader-payload'
import type {
  RuntimeFileOpenResult,
  RuntimeTerminalPathResolution
} from '../../../src/shared/runtime-types'

// Opening things from the session screen: a tapped terminal path, a new markdown note or browser
// tab, the legacy-Codex resume repin, and the structured agent chat.

const terminalPathResolutionReader: RpcCompatibleReader<
  unknown,
  'terminal-path-resolution',
  RuntimeTerminalPathResolution
> = (raw) =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: main cast this payload unread; the reader preserves that, including the property-read throw on a null result.
  rpcReadUnchecked('terminal-path-resolution', raw as RuntimeTerminalPathResolution)

/**
 * A path a terminal printed, resolved to something openable.
 *
 * Second reader on `files.resolveTerminalPath`. The first, `terminalArtifactPathResolve`, exists to
 * mint a fresh grant for an artifact the preview screen already has open and hands its caller the
 * payload whole, because that caller re-derives a preview source from it. The tap is not resolving
 * a known artifact: it reads `exists`, `isDirectory`, `openTarget`, `worktree` and `relativePath`
 * as one resolution and branches on all five. Giving it the whole payload would move that read back
 * to the call site, which is the cast this migration removes. Both skip on a refusal — a tap that
 * cannot resolve leaves terminal focus and input untouched.
 */
export const fileTapPathResolve = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.resolve-tapped-path-or-skip',
    method: 'files.resolveTerminalPath',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: terminalPathResolutionReader
  })
)

/**
 * The worktree open a tap leads to. Its own skip: the tap is best-effort and a refusal is the same
 * silent miss as a path that resolved to nothing. `sourceFileOpenRun` is the Changes screen's read
 * of the same method and raises the host's message instead, because there the user asked for a tab
 * and has nothing otherwise.
 */
export const fileTapOpenRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.open-tapped-file-or-skip',
    method: 'files.open',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: (raw) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: main cast this payload unread; the reader preserves that, including the property-read throw on a null result.
      rpcReadUnchecked('file-open-result', raw as RuntimeFileOpenResult)
  })
)

/**
 * Creating an untitled markdown note. The refusal message is read for the file-exists text the
 * caller retries on, so it has to survive as the thrown message rather than a coded one.
 */
export const sessionMarkdownNoteCreate = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.create-markdown-note',
    method: 'files.createFile',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('markdown-note-created')
  })
)

/** The browser tab a user opens from the tab strip; the reply carries the page id to focus. */
export const sessionBrowserTabCreate = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'browser.create-session-tab',
    method: 'browser.tabCreate',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('browser-tab-created')
  })
)

/**
 * The legacy-Codex resume repin. Its refusal is read raw before interpretation: an older host that
 * cannot prepare answers `method_not_found` or a named `forbidden`, and the phone resumes on the
 * shared home instead — neither a failure nor a value any acceptance policy can express.
 */
export const aiVaultResumePreparationRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'aiVault.prepare-session-resume',
    method: 'aiVault.prepareSessionResume',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('ai-vault-resume-preparation')
  })
)

/**
 * Whether a workspace can host a structured agent chat at all. The launch distrusts the declared
 * envelope type here — a malformed reply must read as unsupported rather than be classified — so
 * the raw reply stays at the call site and no policy interprets it.
 */
export const structuredAgentSupportProbe = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'agentSession.create-support',
    method: 'agentSession.createSupport',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('structured-create-support')
  })
)

/**
 * The durable create. Same distrust, and for a stronger reason: anything this call cannot prove is
 * a definitive refusal has to stay `unknown`, because a create that may have committed must not
 * grow a sibling terminal. The envelope is examined field by field at the call site.
 */
export const structuredAgentSessionCreate = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'agentSession.create',
    method: 'agentSession.create',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('structured-session-created')
  })
)

/** The host record a session-option pick is written to. Best-effort: every outcome is swallowed. */
export const nativeChatSessionOptionsWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'settings.mutate-native-chat-session-options',
    method: 'settings.mutateNativeChatSessionOptions',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('native-chat-session-options-written')
  })
)
