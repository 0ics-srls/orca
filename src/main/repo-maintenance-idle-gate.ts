import { app, powerMonitor } from 'electron'
import {
  disposeLocalRepoMaintenance,
  postponeRepoMaintenance,
  setRepoMaintenanceActivityProbe
} from './git/local-repo-maintenance'
import { hasWorktreeRemovalsInFlight } from './ipc/worktrees/worktree-ipc-context'
import { hasPendingWorktreeCreatePreparations } from './worktree-create-preparation'

/**
 * The app-wide "not now" answer for idle repo maintenance.
 *
 * `pack-refs` holds a general git admission slot for its whole run, which on a
 * large backlog is minutes, and takes the `packed-refs` lock while it writes.
 * Any ref deletion needs that same lock and gives up after
 * `core.packedRefsTimeout` (1s), so worktree removal in particular has to veto
 * this -- as does a create in flight, an agent mid-run, and shutdown. Battery is
 * a veto too: this is work the user did not ask for, and a plugged-in quiet
 * window always comes along later.
 */
export type RepoMaintenanceIdleInputs = {
  isQuitting: () => boolean
  getWorkingAgentCount: () => number
}

export function installRepoMaintenanceIdleGate(
  inputs: RepoMaintenanceIdleInputs
): () => Promise<void> {
  setRepoMaintenanceActivityProbe(
    () =>
      inputs.isQuitting() ||
      inputs.getWorkingAgentCount() > 0 ||
      hasPendingWorktreeCreatePreparations() ||
      hasWorktreeRemovalsInFlight() ||
      isOnBatteryPower()
  )
  // Do-not-start, never stop-what-is-running. Killing a pack to honour a battery
  // or focus change would strand a ref lock roughly one time in five to save at
  // most a couple of minutes of background unlinking; pushing the next attempt
  // out costs nothing and risks nothing.
  const onBattery = (): void => {
    postponeRepoMaintenance()
  }
  const onFocus = (): void => {
    postponeRepoMaintenance()
  }
  powerMonitor.on('on-battery', onBattery)
  app.on('browser-window-focus', onFocus)
  return () => {
    app.off('browser-window-focus', onFocus)
    powerMonitor.off('on-battery', onBattery)
    // Order matters: clearing the probe alone would leave armed timers running
    // against a gate that can no longer see agents, creates, or shutdown.
    const stopped = disposeLocalRepoMaintenance()
    setRepoMaintenanceActivityProbe(null)
    return stopped
  }
}

function isOnBatteryPower(): boolean {
  try {
    return powerMonitor.isOnBatteryPower()
  } catch {
    // Absence of the API is not evidence of battery; desktops answer false anyway.
    return false
  }
}
