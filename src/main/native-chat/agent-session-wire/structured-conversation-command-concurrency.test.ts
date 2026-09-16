import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AgentSessionConversationCommand } from '../../../shared/agent-session-conversation-command'
import { hostTestMessage } from './structured-agent-session-host-test-data'
import {
  CALLER,
  attach,
  envelope,
  hostTestState
} from './structured-agent-session-host-test-harness'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { StructuredAgentSessionHost } from './structured-agent-session-host'

const compact = vi.fn<NonNullable<StructuredAgentSessionAdapter['compact']>>()
let host: StructuredAgentSessionHost
let dispatch: Mock<StructuredAgentSessionAdapter['dispatch']>

function commandParams(command: AgentSessionConversationCommand) {
  return {
    command,
    envelope: envelope('agentSession.conversationCommand', { command })
  }
}

beforeEach(async () => {
  ;({ host, dispatch } = hostTestState())
  compact.mockReset().mockResolvedValue({})
  host.deps.adapter.compact = compact
  await attach()
})

describe('host conversation command concurrency', () => {
  it('replays an accepted send while a later conversation command is running', async () => {
    const body = hostTestMessage('send exactly once')
    const params = { body, envelope: envelope('agentSession.send', { body }) }
    await expect(host.send(CALLER, params)).resolves.toMatchObject({
      ok: true,
      replayed: false,
      value: { submission: { dispatchState: 'accepted' } }
    })

    const completion = Promise.withResolvers<Record<string, never>>()
    compact.mockReturnValueOnce(completion.promise)
    const running = host.conversationCommand(CALLER, commandParams('compact'))
    await vi.waitFor(() => expect(compact).toHaveBeenCalled())

    await expect(host.send(CALLER, params)).resolves.toMatchObject({
      ok: true,
      replayed: true,
      value: { submission: { dispatchState: 'accepted' } }
    })
    const newBody = hostTestMessage('must wait')
    await expect(
      host.send(CALLER, {
        body: newBody,
        envelope: envelope('agentSession.send', { body: newBody })
      })
    ).resolves.toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_invalid' }
    })
    expect(dispatch).toHaveBeenCalledTimes(1)

    completion.resolve({})
    await expect(running).resolves.toMatchObject({ ok: true, value: { state: 'completed' } })
  })

  it('does not coalesce a mismatched duplicate with the active command', async () => {
    const completion = Promise.withResolvers<Record<string, never>>()
    compact.mockReturnValueOnce(completion.promise)
    const params = commandParams('compact')
    const running = host.conversationCommand(CALLER, params)
    await vi.waitFor(() => expect(compact).toHaveBeenCalled())

    const mismatched = host.conversationCommand(CALLER, {
      ...params,
      envelope: { ...params.envelope, payloadFingerprint: '0'.repeat(64) }
    })
    completion.resolve({})

    await expect(running).resolves.toMatchObject({ ok: true, value: { state: 'completed' } })
    await expect(mismatched).resolves.toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_invalid' }
    })
    expect(compact).toHaveBeenCalledTimes(1)
  })
})
