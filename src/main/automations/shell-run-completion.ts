import type { AutomationRun, AutomationRunOutputSnapshot } from '../../shared/automations-types'
import {
  stripAnsiEscapeSequences,
  TERMINAL_CONTROL_CHARACTER_PATTERN
} from '../../shared/ansi-escape-sequences'
import { isProvenProcessExit } from '../../shared/terminal-exit-cause'
import { createAutomationShellReceiptScanner } from '../../shared/automation-shell-exit-receipt'
import { createHeadlessAutomationOutputSnapshotBuffer } from './headless-dispatch'
import type { AutomationRunTerminalHost } from './runtime-terminal-run-observer'
import type { AutomationRunCompletionObservation } from './run-completion-watcher'

function resolveRunHandle(
  runtime: AutomationRunTerminalHost,
  run: AutomationRun,
  fallback: string
): string {
  if (!runtime.resolveTerminalPane || !run.terminalPaneKey) {
    return fallback
  }
  const terminal = runtime.resolveTerminalPane(run.terminalPaneKey, run.workspaceId ?? undefined)
  if (
    terminal.ptyId !== run.terminalPtyId ||
    terminal.incarnationId !== run.terminalIncarnationId
  ) {
    throw new Error('terminal_incarnation_changed')
  }
  return terminal.handle
}

export async function observeShellRunCompletion(
  runtime: AutomationRunTerminalHost,
  handle: string,
  run: AutomationRun,
  signal: AbortSignal,
  onUnverifiable?: (snapshot: AutomationRunOutputSnapshot | null) => void,
  onCommandExit?: (exitCode: number) => void
): Promise<AutomationRunCompletionObservation> {
  if (!run.terminalPtyId || !runtime.subscribeToTerminalData) {
    throw new Error('terminal_not_found')
  }
  const boundHandle = resolveRunHandle(runtime, run, handle)
  let wakeExit = (): void => {}
  const hostExit = new Promise<void>((resolve) => {
    wakeExit = resolve
  })
  const unsubscribeExit = runtime.subscribeToPtyExit?.(run.terminalPtyId, () => wakeExit())
  signal.addEventListener('abort', wakeExit, { once: true })
  // Capture the existing host tail before subscribing, without an async renderer read between them.
  const initial = runtime
    .readTerminal(boundHandle, { limit: 2_000 }, { streamOnly: true })
    .catch(() => ({ tail: [], truncated: false, limited: false }))
  const live = createHeadlessAutomationOutputSnapshotBuffer()
  let commandExitCode: number | null = run.terminalCommandExitCode ?? null
  const receipt = createAutomationShellReceiptScanner(run.id, (code) => {
    commandExitCode = code
    onCommandExit?.(code)
  })
  const unsubscribe = runtime.subscribeToTerminalData(run.terminalPtyId, (data) => {
    try {
      resolveRunHandle(runtime, run, boundHandle)
    } catch {
      return
    }
    receipt.scan(data)
    live.append(data)
  })
  try {
    const seed = await initial
    receipt.scan(seed.tail.join('\n'))
    const snapshot = (): AutomationRunOutputSnapshot | null => {
      const buffer = createHeadlessAutomationOutputSnapshotBuffer()
      buffer.append(seed.tail.join('\n') || run.outputSnapshot?.content || '')
      const captured = live.snapshot()
      if ((seed.tail.length || run.outputSnapshot?.content) && captured) {
        buffer.append('\n')
      }
      buffer.append(captured?.content ?? '')
      const output = buffer.snapshot()
      if (output) {
        output.content = stripAnsiEscapeSequences(output.content)
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .replace(TERMINAL_CONTROL_CHARACTER_PATTERN, '')
          .trim()
        output.truncated ||=
          (captured?.truncated ?? false) || seed.truncated === true || seed.limited === true
        if (!seed.tail.length) {
          output.truncated ||= run.outputSnapshot?.truncated ?? false
        }
      }
      return output
    }
    try {
      const running =
        run.terminalPaneKey &&
        runtime.resolveTerminalPane?.(run.terminalPaneKey, run.workspaceId ?? undefined).connected
      if (unsubscribeExit && running && !signal.aborted) {
        await hostExit
      }
      if (signal.aborted) {
        throw new Error('request_aborted')
      }
      const wait = await runtime.waitForTerminal(resolveRunHandle(runtime, run, boundHandle), {
        condition: 'exit',
        signal
      })
      const hostObservedExit =
        typeof wait.exitCode === 'number' && isProvenProcessExit(wait.exitCode)
      const exitCode = hostObservedExit ? commandExitCode : null
      if (wait.satisfied && exitCode !== null) {
        return {
          status: exitCode === 0 ? 'completed' : 'dispatch_failed',
          outputSnapshot: snapshot(),
          error: exitCode === 0 ? null : `Automation process exited with code ${exitCode}.`
        }
      }
      if (
        wait.satisfied &&
        hostObservedExit &&
        (wait.exitCause?.kind === 'signaled' || wait.exitCause?.kind === 'operator_close')
      ) {
        return {
          status: 'dispatch_failed',
          outputSnapshot: snapshot(),
          error:
            wait.exitCause.kind === 'signaled'
              ? `Automation process was killed by signal ${wait.exitCause.signal}.`
              : 'The automation terminal was closed before the command completed.'
        }
      }
      throw new Error('automation_exit_unverifiable')
    } catch (error) {
      if (!signal.aborted) {
        onUnverifiable?.(snapshot())
      }
      throw error
    }
  } finally {
    signal.removeEventListener('abort', wakeExit)
    unsubscribeExit?.()
    unsubscribe()
  }
}
