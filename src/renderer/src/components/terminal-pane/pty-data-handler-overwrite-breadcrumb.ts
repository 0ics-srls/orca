import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'
import { isPtyDataHandlerShutdownPending, ptyDataHandlers } from './pty-shutdown-data-suspension'

type PtyDataHandler = NonNullable<ReturnType<typeof ptyDataHandlers.get>>

/**
 * Report a second pane claiming a PTY's only data-handler slot.
 *
 * Why not fan the data out instead: two panes on one PTY is the STA-7961 bug, not a mode to
 * support — they also both forward their fit, so the PTY grid flips between two sizes. The one
 * legitimate overlap, a remount, runs through the pending-shutdown queue, which deliberately
 * leaves the outgoing handler in the map; that case is silent.
 */
export function reportOverwrittenPtyDataHandler(ptyId: string, next: PtyDataHandler): void {
  const previous = ptyDataHandlers.get(ptyId)
  if (!previous || previous === next || isPtyDataHandlerShutdownPending(ptyId)) {
    return
  }
  console.warn('[pty] a second pane replaced the data handler for', ptyId)
  recordRendererCrashBreadcrumb('terminal_pty_data_handler_overwritten', { ptyId })
}
