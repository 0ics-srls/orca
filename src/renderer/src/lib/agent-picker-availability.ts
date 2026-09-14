import type { AgentCatalogEntry } from './agent-catalog'
import type { TuiAgent } from '../../../shared/tui-agent'
import { filterEnabledTuiAgents } from '../../../shared/tui-agent-selection'

export type UnavailableAgent = {
  agent: AgentCatalogEntry
  reason: 'disabled' | 'not-detected'
}

export function getAgentPickerAvailability(
  catalog: AgentCatalogEntry[],
  disabledAgents: Iterable<unknown> | null | undefined,
  detectedAgentIds: ReadonlySet<TuiAgent> | null
): { available: AgentCatalogEntry[]; unavailable: UnavailableAgent[] } {
  const enabled = new Set(
    filterEnabledTuiAgents(
      catalog.map((agent) => agent.id),
      disabledAgents
    )
  )
  const available: AgentCatalogEntry[] = []
  const unavailable: UnavailableAgent[] = []
  for (const agent of catalog) {
    if (!enabled.has(agent.id)) {
      unavailable.push({ agent, reason: 'disabled' })
    } else if (detectedAgentIds !== null && !detectedAgentIds.has(agent.id)) {
      unavailable.push({ agent, reason: 'not-detected' })
    } else {
      available.push(agent)
    }
  }
  return { available, unavailable }
}
