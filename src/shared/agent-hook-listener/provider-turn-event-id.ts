import type { AgentHookSource } from '../agent-hook-relay'
import { boundedAgentTurnEvidenceId } from '../agent-turn-evidence-id'
import type { ProviderTurnOutcome } from './provider-turn-evidence-types'

/** Build a stable bounded dedupe key without using display or process identity. */
export function providerTurnEventId(
  source: AgentHookSource,
  paneKey: string,
  name: string,
  turnId: string | undefined,
  outcome: ProviderTurnOutcome | undefined,
  recordKind: 'event' | 'terminal-record' = 'event',
  workId?: string
): string {
  const raw = `provider-turn:${recordKind}:${source}:${paneKey}:${name}:${turnId ?? 'anonymous'}:${workId ?? 'root'}:${outcome ?? 'transition'}`
  return boundedAgentTurnEvidenceId(raw)
}
