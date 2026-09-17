// A run of tool calls → the two facts its collapsed header may state: whether
// the run succeeded, and how many of its calls did not.
//
// Shared, and separate from the live-activity derivation, because success is a
// claim the header makes on its own. "Nothing is running" is not that claim:
// `failed` is neither running nor a success, so a header that reads one off the
// other marks a failed run done and leaves the failure to be found by expanding
// it. Success must be stated, which is what `nativeChatToolRunSucceeded` does.

import { selectActiveToolCall } from './native-chat-tool-activity'
import { pairToolBlocks, type NativeChatToolPair } from './native-chat-tool-fold'
import { isToolCallBlock, type NativeChatBlock } from './native-chat-types'

/** A call that did not succeed: the provider's own `failed` verdict, or a result
 *  the tool returned as an error. Both are needed because only the structured
 *  lanes set lifecycle `state` — this is the same composite test the task-list,
 *  edit-card and ask-row readers already use to reject a call's payload. */
function isFailedToolPair({ call, result }: NativeChatToolPair): boolean {
  return call !== undefined && (call.state === 'failed' || result?.isError === true)
}

/** How many of a run's calls failed, over every call rather than the latest:
 *  a failure anywhere in a collapsed run is what its header has to report. */
export function countFailedToolCalls(blocks: readonly NativeChatBlock[]): number {
  return pairToolBlocks(blocks).filter(isFailedToolPair).length
}

/** Whether the run may be marked done: settled, nothing failed, nothing still
 *  running. The running test is repeated after `selectActiveToolCall` on
 *  purpose — that one reports no active call once the turn is known to be over,
 *  and an item still running cannot inherit completion from its turn.
 *
 *  A call carrying no lifecycle `state` is not a failure and not in flight, so a
 *  legacy transcript still settles; nothing here demands an explicit `completed`
 *  that those lanes never wrote. */
export function nativeChatToolRunSucceeded(
  blocks: readonly NativeChatBlock[],
  { activeTurnIsWorking }: { activeTurnIsWorking?: boolean }
): boolean {
  return (
    selectActiveToolCall(blocks, { activeTurnIsWorking }) === null &&
    !blocks.some((block) => isToolCallBlock(block) && block.state === 'running') &&
    countFailedToolCalls(blocks) === 0
  )
}
