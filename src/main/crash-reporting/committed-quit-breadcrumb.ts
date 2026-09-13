import { recordDurableCrashBreadcrumb } from './durable-crash-breadcrumb'

/** Counterpart to `main_process_lifecycle_started`. Written once per launch on the
 *  committed quit path, so the next launch can tell an orderly exit from a whole-app
 *  death by whether this crumb closes the previous launch's durable trail. */
export const COMMITTED_QUIT_BREADCRUMB_NAME = 'main_process_quit_committed'

export type CommittedQuitReason =
  | 'update-install'
  | 'dev-parent-shutdown'
  | 'system-session-end'
  | 'app-quit'

export type CommittedQuitSignals = {
  quittingForUpdate: boolean
  devParentShutdownRequested: boolean
  systemSessionEnding: boolean
}

// Why ordered, not combined: an update install that lands during a Windows session
// end is still an update install, and that is the reason a triager needs first.
export function resolveCommittedQuitReason(signals: CommittedQuitSignals): CommittedQuitReason {
  if (signals.quittingForUpdate) {
    return 'update-install'
  }
  if (signals.devParentShutdownRequested) {
    return 'dev-parent-shutdown'
  }
  if (signals.systemSessionEnding) {
    return 'system-session-end'
  }
  return 'app-quit'
}

export function recordCommittedQuitBreadcrumb(signals: CommittedQuitSignals): void {
  recordDurableCrashBreadcrumb(COMMITTED_QUIT_BREADCRUMB_NAME, {
    quitReason: resolveCommittedQuitReason(signals)
  })
}
