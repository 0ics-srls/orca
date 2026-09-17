import { randomUUID } from 'node:crypto'
import { makePaneKey } from '../../shared/stable-pane-id'
import { AutomationService } from '../automations/service'
import { createHeadlessAutomationOutputSnapshotBuffer } from '../automations/headless-dispatch'
import { buildHeadlessAutomationWorktreeCreateArgs } from '../automations/headless-workspace-create'
import { createRuntimeAutomationRunTerminalObserver } from '../automations/runtime-terminal-run-observer'
import { mainProcessState as state } from './main-process-state'

export function initializeMainProcessAutomations(): AutomationService {
  const store = state.store
  const runtime = state.runtime
  const claudeUsage = state.claudeUsage
  const codexUsage = state.codexUsage
  if (!store || !runtime || !claudeUsage || !codexUsage) {
    throw new Error('Runtime and usage stores must be initialized before automations')
  }
  const service = new AutomationService(store, {
    claudeUsage,
    codexUsage,
    terminalObserver: createRuntimeAutomationRunTerminalObserver(runtime),
    onAutomationsChanged: (payload) => runtime.notifyAutomationsChanged(payload),
    // Why: desktop clients mirror remote-host automations, but only a server process should execute remote_host_service-owned schedules.
    allowRemoteHostScheduling: state.isServeMode,
    headlessDispatcher: state.isServeMode
      ? async ({ automation, run, target }) => {
          const terminalSnapshotLimit = 2_000
          let terminalHandle = ''
          let terminalSessionId: string | null = null
          let terminalPaneKey: string | null = null
          let terminalPtyId: string | null = null
          let workspaceId = automation.workspaceId ?? ''
          let workspaceDisplayName: string | null = null
          if (automation.workspaceMode === 'new_per_run') {
            const created = await runtime.createManagedWorktree(
              buildHeadlessAutomationWorktreeCreateArgs({ automation, run, repo: target.repo })
            )
            terminalHandle = created.startupTerminal?.handle ?? ''
            terminalSessionId = created.startupTerminal?.tabId ?? null
            terminalPaneKey = created.startupTerminal?.paneKey ?? null
            terminalPtyId = created.startupTerminal?.ptyId ?? null
            workspaceId = created.worktree.id
            workspaceDisplayName = created.worktree.displayName ?? null
            if (automation.agentId !== null && !terminalHandle) {
              throw new Error(
                created.warning ||
                  'Automation workspace was created, but no agent terminal started.'
              )
            }
          }
          if (automation.workspaceMode === 'existing' || automation.agentId === null) {
            if (!workspaceId) {
              throw new Error('The target workspace is no longer available.')
            }
            const shellIdentity =
              automation.agentId === null
                ? { tabId: randomUUID(), leafId: randomUUID() }
                : undefined
            if (shellIdentity) {
              await service.markDispatchResult({
                runId: run.id,
                status: 'dispatching',
                workspaceId,
                workspaceDisplayName,
                terminalSessionId: shellIdentity.tabId,
                terminalPaneKey: makePaneKey(shellIdentity.tabId, shellIdentity.leafId)
              })
            }
            const terminal = await runtime.launchAgentTerminal(`id:${workspaceId}`, {
              agent: automation.agentId,
              automationRunId: run.id,
              prompt: automation.prompt,
              title: run.title,
              ...shellIdentity
            })
            terminalHandle = terminal.handle
            terminalSessionId = terminal.tabId ?? null
            terminalPaneKey = terminal.paneKey ?? null
            terminalPtyId = terminal.ptyId ?? null
            workspaceId = terminal.worktreeId
            const worktree = await runtime.showManagedWorktree(`id:${workspaceId}`)
            workspaceDisplayName = worktree.displayName ?? null
          }
          const completion =
            automation.agentId === null
              ? undefined
              : (async () => {
                  const wait = await runtime.waitForTerminal(terminalHandle, {
                    condition: 'tui-idle'
                  })
                  const read = await runtime.readTerminal(terminalHandle, {
                    limit: terminalSnapshotLimit
                  })
                  const snapshotBuffer = createHeadlessAutomationOutputSnapshotBuffer()
                  snapshotBuffer.append(read.tail.join('\n'))
                  if (wait.satisfied) {
                    return {
                      status: 'completed' as const,
                      outputSnapshot: snapshotBuffer.snapshot(),
                      error: null
                    }
                  }
                  return {
                    status: 'dispatch_failed' as const,
                    outputSnapshot: snapshotBuffer.snapshot(),
                    error: wait.blockedReason
                      ? `Automation agent is blocked: ${wait.blockedReason}.`
                      : 'Automation agent did not report completion.'
                  }
                })()
          return {
            workspaceId,
            workspaceDisplayName,
            terminalSessionId,
            terminalPaneKey,
            terminalPtyId,
            completion
          }
        }
      : undefined
  })
  state.automations = service
  runtime.setAutomationService(service)
  return service
}
