import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  AgentSessionPreDispatchError,
  AGENT_SESSION_ADMISSION_BARRIER_TIMEOUT_MS,
  runSettledAgentSessionMutation
} from './structured-agent-session-operation-settlement'
import {
  adapter,
  envelope,
  hostTestState,
  journals
} from './structured-agent-session-host-test-harness'
import {
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD
} from './structured-agent-session-host-test-data'
import type { AgentSessionTurnContext } from './structured-agent-session-turns'

async function context(): Promise<AgentSessionTurnContext> {
  return {
    sessionId: SESSION,
    journal: await journals.open({
      identity: {
        sessionId: SESSION,
        workspaceId: 'workspace',
        hostId: 'local',
        agent: 'codex',
        providerHandle: { kind: 'codex', threadId: THREAD }
      },
      journalDir: join(hostTestState().root, 'settlement')
    }),
    fence: 1,
    adapter: adapter(),
    persistOptions: async () => {},
    resolvedBy: 'test',
    publish: () => {},
    flushStreamedEvents: async () => {},
    now: () => 0
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it.each([1, 2])(
  'preserves a proven refusal through %s failed bookkeeping writes',
  async (failures) => {
    const ctx = await context()
    const { store, dispatch } = hostTestState()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let writes = 0
    vi.spyOn(store, 'recordOperationOutcome').mockImplementation(async () => {
      writes += 1
      if (writes > 1 && writes <= failures + 1) {
        throw new Error('private unbounded disk detail')
      }
    })
    const refusal = {
      ok: false as const,
      refusal: { code: 'agent_session_operation_invalid' as const, message: 'Not sent.' }
    }
    const run = vi.fn(async () => refusal)
    const result = await runSettledAgentSessionMutation({
      store,
      operationCallerKey: 'test',
      envelope: envelope('agentSession.send', {}),
      context: ctx,
      plan: {
        method: 'agentSession.send',
        fields: {},
        markUnknownBeforeRun: true,
        run,
        replay: () => null
      }
    })
    expect(result).toEqual(refusal)
    expect(run).toHaveBeenCalledOnce()
    expect(dispatch).not.toHaveBeenCalled()
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private unbounded disk detail')
  }
)

it.each(['stalled', 'failed'] as const)(
  'refuses a %s admission barrier without late dispatch',
  async (barrier) => {
    const ctx = await context()
    const { store } = hostTestState()
    vi.spyOn(store, 'recordOperationOutcome').mockResolvedValue()
    const pending = Promise.withResolvers<void>()
    ctx.flushStreamedEvents = () =>
      barrier === 'stalled' ? pending.promise : Promise.reject(new Error('disk unavailable'))
    const beforeRun = vi.fn()
    const run = vi.fn(async () => ({ ok: true as const, value: 'sent' }))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const result = runSettledAgentSessionMutation({
      store,
      operationCallerKey: 'test',
      envelope: envelope('agentSession.send', {}),
      context: ctx,
      plan: { method: 'agentSession.send', fields: {}, beforeRun, run, replay: () => null }
    }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(AGENT_SESSION_ADMISSION_BARRIER_TIMEOUT_MS)
    expect(await result).toBeInstanceOf(AgentSessionPreDispatchError)
    expect(beforeRun).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    pending.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  }
)
