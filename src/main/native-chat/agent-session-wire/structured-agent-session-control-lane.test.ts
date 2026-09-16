import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { structuredAgentSessionControlLaneFor } from './structured-agent-session-control-lane'

const SESSION = 'session-1'

function record(conversationCommand?: {
  command?: 'clear' | 'compact'
  phase: 'prepared' | 'committed'
  state: 'unknown' | 'completed'
}): Pick<AgentSessionRecord, 'conversationCommand'> {
  return conversationCommand
    ? {
        conversationCommand: {
          ...conversationCommand,
          command: conversationCommand.command ?? 'compact',
          operationId: 'op-1',
          callerKey: 'desktop'
        }
      }
    : { conversationCommand: undefined }
}

describe('structuredAgentSessionControlLaneFor', () => {
  it('keeps user controls in order on the main lane when nothing parks it', () => {
    expect(structuredAgentSessionControlLaneFor(SESSION, record())).toBe(SESSION)
    expect(
      structuredAgentSessionControlLaneFor(
        SESSION,
        record({ phase: 'committed', state: 'completed' })
      )
    ).toBe(SESSION)
    expect(structuredAgentSessionControlLaneFor(SESSION, null)).toBe(SESSION)
  })

  it('moves user controls off the main lane while a command awaits its terminal frame', () => {
    const lane = structuredAgentSessionControlLaneFor(
      SESSION,
      record({ phase: 'prepared', state: 'unknown' })
    )

    expect(lane).not.toBe(SESSION)
    expect(lane).toContain(SESSION)
  })

  it('keeps clear serialized with close while the replacement is prepared', () => {
    expect(
      structuredAgentSessionControlLaneFor(
        SESSION,
        record({ command: 'clear', phase: 'prepared', state: 'unknown' })
      )
    ).toBe(SESSION)
  })

  it('uses the live owner decision before the durable record catches up', () => {
    expect(structuredAgentSessionControlLaneFor(SESSION, record(), true)).not.toBe(SESSION)
    expect(
      structuredAgentSessionControlLaneFor(
        SESSION,
        record({ phase: 'prepared', state: 'unknown' }),
        false
      )
    ).toBe(SESSION)
  })
})
