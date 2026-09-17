import { useAppStore } from '../../store'
import { captureParkedTerminalBuffers } from './parked-terminal-buffer-capture'

/** Serialize each newly parked tab's panes while they are still mounted, once per park episode.
 *  Why here rather than at unmount: a remote-runtime tab's xterm is the only client-side copy of
 *  its scrollback, and the paired-parking capability that licenses the unmount is a static build
 *  string — never evidence the host retained this pty's buffer. A host that answers
 *  `no-serializable-buffer` is unverifiable, not empty. Keep the buffer, never discard it.
 *  See docs/reference/ssh-execution-boundary.md.
 *  `capturedTabIds` is mutated in place: it is the caller's ref-held episode ledger. */
export function captureNewlyParkedTerminalTabs(
  worktreeId: string,
  parkedTabIds: ReadonlySet<string>,
  capturedTabIds: Set<string>
): void {
  for (const tabId of Array.from(capturedTabIds)) {
    if (!parkedTabIds.has(tabId)) {
      capturedTabIds.delete(tabId)
    }
  }
  if (capturedTabIds.size === parkedTabIds.size) {
    return
  }
  const repos = useAppStore.getState().repos
  for (const tabId of parkedTabIds) {
    if (capturedTabIds.has(tabId)) {
      continue
    }
    // Why one tab per call: coverage is reported for the whole batch, and a tab mid-remount must
    // stay unmarked so the next pass retries it instead of parking it uncaptured.
    if (captureParkedTerminalBuffers({ worktreeId, tabIds: [tabId], repos })) {
      capturedTabIds.add(tabId)
    }
  }
}
