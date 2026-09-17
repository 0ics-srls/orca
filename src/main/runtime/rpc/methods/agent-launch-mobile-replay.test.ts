import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorktreeWithNameRetry } from '../../../../../mobile/src/tasks/worktree-create-retry'
import type { RpcClient } from '../../../../../mobile/src/transport/rpc-client'
import { LogicalClientCutoverError } from '../../../../../mobile/src/transport/stable-logical-rpc-client'
import {
  AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS,
  AGENT_SESSION_OPERATION_FUTURE_SKEW_MS
} from '../../../../shared/agent-session-host-authority'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import { AgentSessionRecordStore } from '../../agent-session-record-store'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { runtimeStub } from './agent-launch.test-fixture'

const createStructuredSession = vi.fn()
vi.mock('./structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: (...args: unknown[]) => createStructuredSession(...args)
}))
const { AGENT_LAUNCH_METHODS } = await import('./agent-launch')

let directory: string
let store: AgentSessionRecordStore

beforeEach(async () => {
  createStructuredSession.mockReset()
  createStructuredSession.mockResolvedValue({ ok: true, value: { sessionId: 'session-1' } })
  directory = await mkdtemp(join(tmpdir(), 'orca-mobile-launch-replay-'))
  store = await AgentSessionRecordStore.open({ directory, hostId: 'local' })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the launch reads only deps.store; structured session creation is the injected boundary above.
  setStructuredAgentSessionHost({ deps: { store } } as unknown as StructuredAgentSessionHost)
})

afterEach(async () => {
  vi.restoreAllMocks()
  setStructuredAgentSessionHost(null)
  await rm(directory, { recursive: true, force: true })
})

function mobileLaunch(args: { loseFirstReplyAfterMs?: number } = {}) {
  const runtime = { ...runtimeStub(), getRuntimeId: () => 'runtime-1' }
  const dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this fixture implements the launch handler and dispatcher metadata dependencies.
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: AGENT_LAUNCH_METHODS
  })
  const operationId = `${Date.now()}-000000000000000000000000000000aa`
  const attempts: unknown[] = []
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mobile retry loop reaches only these transport members; requests use the real host dispatcher.
  const client = {
    getState: () => 'connected',
    sendRequest: async (method: string, params: unknown) => {
      attempts.push(params)
      const response = await dispatcher.dispatch({
        id: `request-${attempts.length}`,
        authToken: 'token',
        method,
        params
      })
      if (attempts.length === 1 && args.loseFirstReplyAfterMs !== undefined) {
        const later = Date.now() + args.loseFirstReplyAfterMs
        vi.spyOn(Date, 'now').mockReturnValue(later)
        throw new LogicalClientCutoverError()
      }
      return response
    }
  } as unknown as RpcClient
  const result = createWorktreeWithNameRetry({
    client,
    baseName: 'otter',
    buildParams: (name) => ({ repo: 'id:repo-1', name }),
    worktreeCreateIdempotency: { dedupeTtlMs: 60_000 },
    agentLaunch: { agent: 'claude', supported: { replay: true } },
    mintLaunchOperationId: () => operationId
  })
  return { runtime, attempts, operationId, result }
}

describe('mobile launch retries through the host ledger', () => {
  it.each([
    'agent_session_operation_capacity',
    'agent_session_operation_invalid',
    'agent_session_operation_expired'
  ])('does not create another workspace after a nested %s refusal', async (code) => {
    createStructuredSession.mockResolvedValue({ ok: false, refusal: { code, message: code } })
    const launch = mobileLaunch()

    await expect(launch.result).resolves.toEqual({ error: code })
    expect(launch.runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(launch.attempts).toHaveLength(1)
    expect(store.listOperationRows()[0]?.outcome.status).toBe('unknown')
  })

  it('keeps the operation identity after its receipt expires during a lost reply', async () => {
    const launch = mobileLaunch({
      loseFirstReplyAfterMs:
        AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS + AGENT_SESSION_OPERATION_FUTURE_SKEW_MS + 1
    })

    await expect(launch.result).resolves.toEqual({ error: 'agent_session_operation_expired' })
    expect(launch.runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(createStructuredSession).toHaveBeenCalledTimes(1)
    expect(launch.attempts).toHaveLength(2)
  })

  it('replays a lost reply beyond the legacy cache window without creating again', async () => {
    const launch = mobileLaunch({ loseFirstReplyAfterMs: 61_000 })

    await expect(launch.result).resolves.toEqual({ worktreeId: 'wt-new', name: 'otter' })
    expect(launch.runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(createStructuredSession).toHaveBeenCalledTimes(1)
    expect(launch.attempts).toHaveLength(2)
    expect(launch.attempts[1]).toEqual(launch.attempts[0])
    expect(launch.runtime.dedupeWorktreeCreate).not.toHaveBeenCalled()
  })
})
