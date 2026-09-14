import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AgentCombobox from '../../../src/renderer/src/components/agent/AgentCombobox'
import { getAgentCatalog } from '../../../src/renderer/src/lib/agent-catalog'
import { getAgentPickerAvailability } from '../../../src/renderer/src/lib/agent-picker-availability'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import './fixture.css'
function App() {
  const [selected, setSelected] = useState<TuiAgent | null>(null)
  const [managed, setManaged] = useState(false)
  const disabled = new URLSearchParams(window.location.search).has('disabled')
  const { available, unavailable } = getAgentPickerAvailability(
    getAgentCatalog(),
    disabled ? ['omp'] : [],
    new Set(['pi'])
  )
  return (
    <main className="p-6 bg-background text-foreground space-y-4">
      <h1>Agent picker</h1>
      <AgentCombobox
        agents={available}
        unavailableAgents={unavailable}
        value={selected}
        onValueChange={setSelected}
        onOpenManageAgents={() => setManaged(true)}
        allowBlankTerminal={false}
      />
      <p>Selected agent: {selected ?? 'none'}</p>
      {managed && <p>Manage agents requested</p>}
    </main>
  )
}
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<App />)
}
