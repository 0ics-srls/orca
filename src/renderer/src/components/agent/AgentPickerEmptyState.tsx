import { translate } from '@/i18n/i18n'
import { searchAgentPickerEntries } from '@/lib/agent-picker-search'
import type { UnavailableAgent } from '@/lib/agent-picker-availability'

export function AgentPickerEmptyState({
  query,
  unavailable
}: {
  query: string
  unavailable: readonly UnavailableAgent[]
}): React.JSX.Element {
  const matches = query.trim()
    ? searchAgentPickerEntries(
        unavailable.map(({ agent }) => agent),
        query
      )
    : []
  if (!query.trim() && unavailable.length > 0) {
    return (
      <>
        {translate(
          'agents.picker.noneAvailable',
          'No agents available. Open Manage agents to check installation and enabled agents on the workspace host.'
        )}
      </>
    )
  }
  if (matches.length === 0) {
    return (
      <>
        {translate(
          'auto.components.agent.AgentCombobox.579c768bde',
          'No agents match your search.'
        )}
      </>
    )
  }
  return (
    <div className="space-y-3 px-3 text-left">
      {matches.map((agent) => {
        const reason = unavailable.find((entry) => entry.agent.id === agent.id)?.reason
        return (
          <div key={agent.id} className="space-y-1">
            <p className="font-medium">{agent.label}</p>
            <p className="text-xs text-muted-foreground">
              {reason === 'disabled'
                ? translate(
                    'agents.picker.disabled',
                    'Disabled in Agents settings. Enable it in Manage agents.'
                  )
                : translate(
                    'agents.picker.notDetected',
                    'Not detected on the workspace host. Make sure {{command}} is on that host’s PATH, then recheck in Manage agents.',
                    { command: agent.cmd }
                  )}
            </p>
          </div>
        )
      })}
    </div>
  )
}
