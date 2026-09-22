import type { TuiAgent } from './tui-agent'
import { isMuseVersionedBinary } from './muse-process-recognition'

/** Packaged CLIs report a versioned binary instead of the name Orca launched. */
export function packagedAgentForProcessName(
  normalized: string,
  exact: (name: string) => TuiAgent | undefined
): TuiAgent | undefined {
  if (normalized.startsWith('codex-')) {
    return exact('codex')
  }
  if (normalized.startsWith('grok-')) {
    return exact('grok')
  }
  if (isMuseVersionedBinary(normalized)) {
    return exact('muse')
  }
  return undefined
}
