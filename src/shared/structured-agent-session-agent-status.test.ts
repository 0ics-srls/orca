import { describe, expect, it } from 'vitest'
import type { AgentSessionBackgroundTask } from './agent-session-background-task-wire'
import { structuredAgentSessionAgentStatus } from './structured-agent-session-agent-status'

function task(over: Partial<AgentSessionBackgroundTask> = {}): AgentSessionBackgroundTask {
  return { id: 'task-1', kind: 'agent', state: 'working', ...over }
}

describe('structuredAgentSessionAgentStatus', () => {
  it('maps a lead that is still working or needs attention without consulting children', () => {
    expect(structuredAgentSessionAgentStatus({ status: 'working' })).toEqual({ state: 'working' })
    expect(
      structuredAgentSessionAgentStatus({
        status: 'attention',
        backgroundTasks: [task({ kind: 'command' })]
      })
    ).toEqual({ state: 'blocked' })
  })

  it('keeps an idle lead working while a subagent runs', () => {
    expect(
      structuredAgentSessionAgentStatus({ status: 'idle', backgroundTasks: [task()] })
    ).toEqual({ state: 'working' })
  })

  it('reads an idle lead with only a backgrounded shell as monitoring', () => {
    expect(
      structuredAgentSessionAgentStatus({
        status: 'idle',
        backgroundTasks: [task({ kind: 'command', description: 'sleep 180' })]
      })
    ).toEqual({ state: 'working', workingMode: 'monitoring' })
  })

  it('keeps an idle lead working while a subagent is blocked or out of contact', () => {
    for (const state of ['waiting', 'blocked', 'unverifiable'] as const) {
      expect(
        structuredAgentSessionAgentStatus({ status: 'idle', backgroundTasks: [task({ state })] })
      ).toEqual({ state: 'working' })
    }
  })

  it('settles an idle lead once every task has settled', () => {
    expect(
      structuredAgentSessionAgentStatus({
        status: 'idle',
        backgroundTasks: [
          task({ state: 'done' }),
          task({ id: 'shell', kind: 'command', state: 'idle' })
        ]
      })
    ).toEqual({ state: 'done' })
    expect(structuredAgentSessionAgentStatus({ status: 'idle' })).toEqual({ state: 'done' })
  })
})
