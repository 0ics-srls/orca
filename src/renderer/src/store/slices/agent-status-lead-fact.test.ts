import { describe, expect, it } from 'vitest'
import { normalizeAgentStatusEvent } from '../../hooks/ipc-events/normalize-agent-status-event'
import { createTestStore } from './store-test-helpers'

const PANE = 'tab-1:11111111-1111-4111-8111-111111111111'

describe('the lead fact on a renderer status entry', () => {
  it('lands on the entry from the IPC payload and is reused by reference when unchanged', () => {
    const store = createTestStore()
    const lead = { state: 'done' as const, outcome: 'failure' as const, stateStartedAt: 5 }
    store
      .getState()
      .setAgentStatus(PANE, { state: 'working', prompt: 'go', agentType: 'claude', lead })
    const first = store.getState().agentStatusByPaneKey[PANE]
    expect(first.lead).toEqual(lead)

    store.getState().setAgentStatus(PANE, {
      state: 'working',
      prompt: 'go',
      agentType: 'claude',
      toolName: 'Read',
      lead: { ...lead }
    })
    expect(store.getState().agentStatusByPaneKey[PANE].lead).toBe(first.lead)
  })

  it('keeps the lead behind an unchanged state when a writer carries none, and drops it on a state edge', () => {
    const store = createTestStore()
    const lead = { state: 'done' as const, stateStartedAt: 5 }
    store
      .getState()
      .setAgentStatus(PANE, { state: 'working', prompt: 'go', agentType: 'claude', lead })
    // A renderer-side OSC parse repaints the state with no lead fact of its own.
    store.getState().setAgentStatus(PANE, {
      state: 'working',
      prompt: 'go',
      agentType: 'claude',
      toolName: 'Bash'
    })
    expect(store.getState().agentStatusByPaneKey[PANE].lead).toEqual(lead)

    store.getState().setAgentStatus(PANE, { state: 'done', prompt: 'go', agentType: 'claude' })
    expect(store.getState().agentStatusByPaneKey[PANE].lead).toBeUndefined()
  })

  it('survives the IPC event normalizer', () => {
    const lead = { state: 'working' as const, stateStartedAt: 9 }
    expect(
      normalizeAgentStatusEvent({
        paneKey: PANE,
        connectionId: null,
        receivedAt: 10,
        stateStartedAt: 9,
        state: 'working',
        prompt: 'go',
        lead
      })?.lead
    ).toEqual(lead)
  })
})
