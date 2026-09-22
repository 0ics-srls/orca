import { describe, expect, it } from 'vitest'
import {
  agentChildWorkLiveness,
  agentChildWorkLivenessFromEvidence,
  type AgentChildWorkLivenessCandidate
} from './agent-status-child-work-liveness'

function child(
  over: Partial<AgentChildWorkLivenessCandidate> = {}
): AgentChildWorkLivenessCandidate {
  return { kind: 'agent', state: 'working', ...over }
}

describe('agentChildWorkLivenessFromEvidence', () => {
  it('lets live agent work outrank live watch loops', () => {
    expect(
      agentChildWorkLivenessFromEvidence({ hasLiveAgentWork: true, hasLiveNonAgentWork: true })
    ).toBe('working')
    expect(
      agentChildWorkLivenessFromEvidence({ hasLiveAgentWork: false, hasLiveNonAgentWork: true })
    ).toBe('monitoring')
    expect(
      agentChildWorkLivenessFromEvidence({ hasLiveAgentWork: false, hasLiveNonAgentWork: false })
    ).toBeNull()
  })
})

describe('agentChildWorkLiveness', () => {
  it('reads working, monitoring and stateless agents and workflows as live agent work', () => {
    for (const state of ['working', 'monitoring', undefined] as const) {
      expect(agentChildWorkLiveness([child({ state })])).toBe('working')
    }
    expect(agentChildWorkLiveness([child({ kind: 'workflow' })])).toBe('working')
  })

  it('keeps a waiting, blocked or unverifiable agent live, the way a shell in those states is', () => {
    for (const state of ['waiting', 'blocked', 'unverifiable'] as const) {
      expect(agentChildWorkLiveness([child({ state })])).toBe('working')
      expect(agentChildWorkLiveness([child({ kind: 'command', state })])).toBe('monitoring')
    }
  })

  it('retires an agent only on an explicitly settled state', () => {
    for (const state of ['done', 'idle'] as const) {
      expect(agentChildWorkLiveness([child({ state })])).toBeNull()
    }
  })

  it('reads any shell, monitor or unknown task that is not explicitly settled as a watch loop', () => {
    for (const kind of ['command', 'monitor', 'unknown'] as const) {
      for (const state of ['working', 'monitoring', 'unverifiable', undefined] as const) {
        expect(agentChildWorkLiveness([child({ kind, state })])).toBe('monitoring')
      }
      for (const state of ['done', 'idle'] as const) {
        expect(agentChildWorkLiveness([child({ kind, state })])).toBeNull()
      }
    }
  })

  it('lets one live agent outrank any number of watch loops', () => {
    expect(
      agentChildWorkLiveness([child({ kind: 'command' }), child({ kind: 'monitor' }), child()])
    ).toBe('working')
  })

  it('treats an absent or empty list as no child work', () => {
    expect(agentChildWorkLiveness(undefined)).toBeNull()
    expect(agentChildWorkLiveness([])).toBeNull()
  })
})
