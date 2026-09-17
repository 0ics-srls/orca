import { isFinalAutomationRunStatus, type AutomationRun } from '../../shared/automations-types'
import type { Store } from '../persistence'
import type { AutomationRunWriter } from './automation-run-writer'

export type ShellRunTerminalBinding = {
  workspaceId: string
  paneKey: string
  ptyId: string
  incarnationId: string
}

export class ShellRunTerminalBindings {
  private readonly pending = new Map<string, AutomationRun>()

  restore(retained: AutomationRun[], runs: AutomationRunWriter): void {
    for (const run of retained) {
      this.remember(run)
      if (run.completionCondition === 'exit' && !isFinalAutomationRunStatus(run.status)) {
        runs.updateRun({
          runId: run.id,
          status: run.status,
          error: 'Orca is waiting for the execution host to confirm this command’s completion.'
        })
      }
    }
  }

  remember(run: AutomationRun): void {
    if (run.completionCondition !== 'exit' || !run.workspaceId || !run.terminalPaneKey) {
      return
    }
    const key = JSON.stringify([run.workspaceId, run.terminalPaneKey])
    if (isFinalAutomationRunStatus(run.status) || run.terminalIncarnationId) {
      this.pending.delete(key)
    } else {
      this.pending.set(key, run)
    }
  }

  bind(
    store: Pick<Store, 'listAutomationRuns'>,
    runs: AutomationRunWriter,
    binding: ShellRunTerminalBinding
  ): AutomationRun | null {
    const key = JSON.stringify([binding.workspaceId, binding.paneKey])
    const reserved = this.pending.get(key)
    if (!reserved) {
      return null
    }
    const run = store
      .listAutomationRuns(reserved.automationId)
      .find((run) => run.id === reserved.id)
    if (!run || isFinalAutomationRunStatus(run.status)) {
      this.pending.delete(key)
      return null
    }
    if (
      (run.terminalPtyId && run.terminalPtyId !== binding.ptyId) ||
      (run.terminalIncarnationId && run.terminalIncarnationId !== binding.incarnationId)
    ) {
      return null
    }
    const bound = runs.updateRun({
      runId: run.id,
      status: 'dispatched',
      terminalPtyId: binding.ptyId,
      terminalIncarnationId: binding.incarnationId
    })
    this.pending.delete(key)
    return bound
  }
}
