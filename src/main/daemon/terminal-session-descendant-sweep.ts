import * as descendantTermination from '../pty-descendant-termination'
import type { ProcessTableReader } from '../pty-descendant-termination'
import type { DescendantTreeVerdict } from '../pty-descendant-exit-verification'
import {
  sweepSessionDescendants,
  type SessionDescendantSweepDeps
} from '../pty-session-descendant-sweep'
import type { PtySessionProcessIdentity } from '../pty-session-identity'

// Keep one fresh table for the short burst of sweep rounds that follows a teardown signal.
// This bounds process-table fanout without reusing a completed capture for a later round.
let sharedShutdownCapture: {
  promise: ReturnType<ProcessTableReader>
  expires?: ReturnType<typeof setTimeout>
} | null = null

const readShutdownProcessTable: ProcessTableReader = (timeoutMs) => {
  if (sharedShutdownCapture) {
    return sharedShutdownCapture.promise
  }
  const promise = descendantTermination.readProcessTable(timeoutMs)
  sharedShutdownCapture = { promise }
  const clear = (): void => {
    if (sharedShutdownCapture?.promise === promise) {
      sharedShutdownCapture = null
    }
  }
  void promise.then(() => {
    const expires = setTimeout(clear, 25)
    expires.unref?.()
    if (sharedShutdownCapture?.promise === promise) {
      sharedShutdownCapture.expires = expires
    }
  }, clear)
  return promise
}

/**
 * The one sweep every terminal-session teardown runs — kill, daemon shutdown,
 * and natural PTY exit alike. Each drives it from the same session identity, so
 * what is reachable no longer depends on whether a live root survived to be
 * walked.
 */
export function sweepTerminalSessionDescendants(
  identity: PtySessionProcessIdentity,
  deps: SessionDescendantSweepDeps = {}
): Promise<DescendantTreeVerdict> {
  return sweepSessionDescendants(identity, {
    // Leave room for capture and root exit within daemon-entry's 5s shutdown budget.
    verifyMs: 2500,
    timeoutMs: 250,
    keepAlive: true,
    readTable: readShutdownProcessTable,
    ...deps
  })
}
