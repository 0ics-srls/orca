import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { structuredAgentSessionControlLaneFor } from './structured-agent-session-control-lane'

const SESSION = 'session-1'

function record(conversationCommand?: {
  phase: 'prepared' | 'committed'
  state: 'unknown' | 'completed'
}): Pick<AgentSessionRecord, 'conversationCommand'> {
  return conversationCommand
    ? {
        conversationCommand: {
          ...conversationCommand,
          command: 'compact',
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
})
