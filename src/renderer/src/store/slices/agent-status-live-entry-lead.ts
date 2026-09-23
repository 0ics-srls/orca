import {
  agentLeadStatusEqual,
  type AgentLeadStatus,
  type AgentStatusEntry,
  type AgentStatusPayload
} from '../../../../shared/agent-status-types'

/** The lead fact a live entry carries. A writer with no lead fact of its own (OSC bytes, launch
 *  seeds) repaints the state the row already holds, and the lead behind an unchanged state is
 *  unchanged too — the same rule main's OSC ingest applies. The existing object is reused when
 *  nothing changed so subscribers can compare by reference. */
export function resolveAgentStatusLiveEntryLead(
  existing: AgentStatusEntry | undefined,
  payload: Pick<AgentStatusPayload, 'state' | 'lead'>,
  agentType: AgentStatusEntry['agentType']
): AgentLeadStatus | undefined {
  const next =
    payload.lead ??
    (existing?.state === payload.state && existing.agentType === agentType
      ? existing.lead
      : undefined)
  return agentLeadStatusEqual(existing?.lead, next) ? existing?.lead : next
}
