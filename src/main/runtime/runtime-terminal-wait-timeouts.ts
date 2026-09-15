import type { RuntimeTerminalWait as RuntimeTerminalWaitResult } from '../../shared/runtime-types'
import { buildPtyTerminalWaitResult, buildTerminalWaitResult } from './terminal-wait-results'
import { buildTerminalWaitText } from './terminal-wait-tail-state'
import type { RuntimeTerminalWaitEvidence } from './runtime-terminal-wait-evidence'
import type { RuntimeLeafRecord, RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'

type RuntimeTerminalWaitTimeoutDependencies = {
  getLivePty(handle: string): { pty: RuntimePtyWorktreeRecord } | null
  getLiveLeaf(handle: string): { leaf: RuntimeLeafRecord }
}

export function resolvePtyTuiIdleTimeout(
  handle: string,
  resolve: (result: RuntimeTerminalWaitResult) => void,
  reject: (error: Error) => void,
  deps: RuntimeTerminalWaitTimeoutDependencies,
  evidence: RuntimeTerminalWaitEvidence
): void {
  const live = deps.getLivePty(handle)
  if (!live) {
    reject(new Error('terminal_handle_stale'))
    return
  }
  const current = live.pty
  const currentText = buildTerminalWaitText(
    current.tailBuffer,
    current.tailPartialLine,
    current.preview
  )
  resolve(
    buildPtyTerminalWaitResult(
      handle,
      'tui-idle',
      current,
      evidence.result(evidence.observePty(current, currentText))
    )
  )
}

export function resolveLeafTuiIdleTimeout(
  handle: string,
  resolve: (result: RuntimeTerminalWaitResult) => void,
  reject: (error: Error) => void,
  deps: RuntimeTerminalWaitTimeoutDependencies,
  evidence: RuntimeTerminalWaitEvidence
): void {
  let current: RuntimeLeafRecord
  try {
    current = deps.getLiveLeaf(handle).leaf
  } catch {
    reject(new Error('terminal_handle_stale'))
    return
  }
  const currentText = buildTerminalWaitText(
    current.tailBuffer,
    current.tailPartialLine,
    current.preview
  )
  resolve(
    buildTerminalWaitResult(
      handle,
      'tui-idle',
      current,
      evidence.result(evidence.observeLeaf(current, currentText))
    )
  )
}
