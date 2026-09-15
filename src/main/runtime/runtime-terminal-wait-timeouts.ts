import type { RuntimeTerminalWait as RuntimeTerminalWaitResult } from '../../shared/runtime-types'
import { buildPtyTerminalWaitResult, buildTerminalWaitResult } from './terminal-wait-results'
import { buildTerminalWaitText } from './terminal-wait-tail-state'
import type { RuntimeTerminalWaitEvidence } from './runtime-terminal-wait-evidence'
import type { RuntimeLeafRecord, RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'
import type { TuiIdleEvidenceCursor } from './tui-idle-evidence'

type RuntimeTerminalWaitTimeoutDependencies = {
  getLivePty(handle: string): { pty: RuntimePtyWorktreeRecord } | null
  getLiveLeaf(handle: string): { leaf: RuntimeLeafRecord }
}

export function resolvePtyTuiIdleTimeout(
  handle: string,
  resolve: (result: RuntimeTerminalWaitResult) => void,
  reject: (error: Error) => void,
  deps: RuntimeTerminalWaitTimeoutDependencies,
  evidence: RuntimeTerminalWaitEvidence,
  evidenceCursor?: TuiIdleEvidenceCursor
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
      evidence.result(evidence.observePty(current, currentText, evidenceCursor))
    )
  )
}

export function resolveLeafTuiIdleTimeout(
  handle: string,
  resolve: (result: RuntimeTerminalWaitResult) => void,
  reject: (error: Error) => void,
  deps: RuntimeTerminalWaitTimeoutDependencies,
  evidence: RuntimeTerminalWaitEvidence,
  evidenceCursor?: TuiIdleEvidenceCursor
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
      evidence.result(evidence.observeLeaf(current, currentText, evidenceCursor))
    )
  )
}
