import { describe, expect, it } from 'vitest'
import { AGENT_CATALOG } from './agent-catalog'
import { getAgentPickerAvailability } from './agent-picker-availability'

describe('agent picker availability', () => {
  it('keeps unknown detection selectable without claiming agents are missing', () => {
    const result = getAgentPickerAvailability(AGENT_CATALOG, [], null)
    expect(result.available).toEqual(AGENT_CATALOG)
    expect(result.unavailable).toEqual([])
  })
  it('uses only the supplied host detection and separates missing from disabled', () => {
    const result = getAgentPickerAvailability(AGENT_CATALOG, ['pi'], new Set(['pi', 'codex']))
    expect(result.available.map((agent) => agent.id)).toEqual(['codex'])
    expect(result.unavailable.find(({ agent }) => agent.id === 'pi')?.reason).toBe('disabled')
    expect(result.unavailable.find(({ agent }) => agent.id === 'omp')?.reason).toBe('not-detected')
  })
  it('does not reuse another host availability', () => {
    const remote = getAgentPickerAvailability(AGENT_CATALOG, [], new Set(['omp']))
    const local = getAgentPickerAvailability(AGENT_CATALOG, [], new Set(['codex']))
    expect(remote.available.map((agent) => agent.id)).toEqual(['omp'])
    expect(local.available.map((agent) => agent.id)).toEqual(['codex'])
  })
})
