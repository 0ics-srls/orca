/**
 * Replay safety for `agent.launch`, against the real durable ledger.
 *
 * The property under test is narrow and total: one execution per operation, a recorded answer for
 * every replay, a truthful refusal when the outcome is unknown. Each guard here has an ablation
 * beside it, because a replay test that never watched the unguarded code duplicate is a test of the
 * harness rather than of the guard.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import {
  computeAgentLaunchFingerprint,
  deriveAgentLaunchChildOperationId,
  type AgentLaunchFingerprintInput
} from '../../../../shared/agent-launch-operation'
import {
  claimAgentSessionOperation,
  settleAgentSessionOperation,
  type AgentSessionOperationRow
} from '../../../../shared/agent-session-operation-ledger'
import { AgentSessionRecordStore } from '../../agent-session-record-store'
import { agentSessionStorePath } from '../../agent-session-record-store-file'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import type { RpcContext } from '../core'
import {
  methodNamed,
  rpcContext,
  runtimeStub,
  type AgentLaunchRuntimeStub
} from './agent-launch.test-fixture'

type StructuredCreateReply =
  | { ok: true; value: { sessionId: string } }
  | { ok: false; refusal: { code: string; message: string } }

/** Records the operation id the launch handed its inner attach, so the child-id rule is observable
 *  rather than inferred. */
const attachOperationIds: string[] = []

const createStructuredSession = vi.fn(
  async (args: { envelope: { clientOperationId: string } }): Promise<StructuredCreateReply> => {
    attachOperationIds.push(args.envelope.clientOperationId)
    return { ok: true, value: { sessionId: 'sess-1' } }
  }
)

vi.mock('./structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: (args: { envelope: { clientOperationId: string } }) =>
    createStructuredSession(args)
}))

const { AGENT_LAUNCH_METHODS } = await import('./agent-launch')

const AGENT_LAUNCH = methodNamed(AGENT_LAUNCH_METHODS, 'agent.launch')

// Real wall-clock, because the handler admits against `Date.now()`: the ledger refuses an id dated
// far from now in either direction, so a frozen fixture timestamp would only ever test that.
const NOW = Date.now()
const OPERATION_ID = `${NOW}-000000000000000000000000000000aa`

/** Paired identity and bearer identity derive the launch's caller key differently, and only the
 *  bearer-identity shape can collide with what the inner attach reserves under. */
const PAIRED_CLIENT: Partial<RpcContext> = {
  clientKind: 'mobile',
  pairedDeviceId: 'device-1',
  clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY]
}
const BEARER_CLIENT: Partial<RpcContext> = {
  clientKind: 'runtime',
  clientId: 'client-9',
  clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY]
}

let directory: string
let store: AgentSessionRecordStore

type LaunchParams = AgentLaunchFingerprintInput & { operationId?: string }

function createLaunch(overrides: Partial<LaunchParams> = {}): LaunchParams {
  return {
    agent: 'claude',
    target: { kind: 'create-worktree', create: { repo: 'id:repo-1', name: 'task' } },
    ...overrides
  }
}

async function launch(
  params: LaunchParams,
  runtime: AgentLaunchRuntimeStub,
  context: Partial<RpcContext> = PAIRED_CLIENT
) {
  const parsed = AGENT_LAUNCH.params.safeParse(params)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'invalid')
  }
  return AGENT_LAUNCH.handler(parsed.data, rpcContext(runtime, context))
}

function rowFor(operationId: string): AgentSessionOperationRow | undefined {
  return store.listOperationRows().find((row) => row.operationId === operationId)
}

beforeEach(async () => {
  attachOperationIds.length = 0
  createStructuredSession.mockClear()
  directory = await mkdtemp(join(tmpdir(), 'orca-agent-launch-replay-'))
  store = await AgentSessionRecordStore.open({ directory, hostId: 'local' })
  // The launch reaches the ledger through the installed host; nothing else on the host is used,
  // because the structured create below it is mocked out.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `deps.store` is the only member `agent.launch` reads, and a member it omits throws on call.
  setStructuredAgentSessionHost({ deps: { store } } as unknown as StructuredAgentSessionHost)
})

afterEach(async () => {
  setStructuredAgentSessionHost(null)
  await rm(directory, { recursive: true, force: true })
})

describe('exactly one execution per launch operation', () => {
  it('runs one of two callers that both observe a pending row', async () => {
    const runtime = runtimeStub()
    const params = createLaunch({ operationId: OPERATION_ID })
    const [first, second] = await Promise.allSettled([
      launch(params, runtime),
      launch(params, runtime)
    ])

    expect(runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(createStructuredSession).toHaveBeenCalledTimes(1)
    const settled = [first, second].filter((result) => result.status === 'fulfilled')
    expect(settled).toHaveLength(1)
  })

  it('ABLATION: reading the row and then writing unknown lets both callers claim it', async () => {
    // The composition this replaced: observe the admitted row, then settle it `unknown`.
    // `settleAgentSessionOperation` replaces the outcome blind, so serializing the two writes tells
    // neither caller that the other got there first — and with this substituted into the handler,
    // the test above creates two worktrees for one tap.
    const blindClaim = async (callerKey: string): Promise<'won' | 'lost'> => {
      const before = rowFor(OPERATION_ID)?.outcome.status
      await store.recordOperationOutcome({
        callerKey,
        operationId: OPERATION_ID,
        outcome: { status: 'unknown' }
      })
      return before === 'pending' ? 'won' : 'lost'
    }
    await store.admitOperation({
      callerKey: 'device-1',
      operationId: OPERATION_ID,
      fingerprint: 'fp-1',
      now: NOW
    })

    const blind = await Promise.all([blindClaim('device-1'), blindClaim('device-1')])
    expect(blind.filter((claim) => claim === 'won')).toHaveLength(2)
  })

  it('the atomic claim admits exactly one winner where the blind settle admitted two', async () => {
    await store.admitOperation({
      callerKey: 'device-1',
      operationId: OPERATION_ID,
      fingerprint: 'fp-1',
      now: NOW
    })

    const claims = await Promise.all([
      store.claimOperation({ callerKey: 'device-1', operationId: OPERATION_ID }),
      store.claimOperation({ callerKey: 'device-1', operationId: OPERATION_ID })
    ])
    expect(claims.filter((claim) => claim.claim === 'won')).toHaveLength(1)
    expect(claims.filter((claim) => claim.claim === 'lost')).toHaveLength(1)
  })
})

describe('a replay answers from the record', () => {
  it('returns the whole recorded result rather than recomputing it', async () => {
    const runtime = runtimeStub({ createWarning: 'Could not copy untracked files.' })
    const params = createLaunch({
      operationId: OPERATION_ID,
      prompt: { text: 'go', delivery: 'draft' }
    })
    const first = await launch(params, runtime)

    // The settings that produced the receipt move underneath the replay. A recomputed answer would
    // now say the user prefers a terminal; the recorded one still says what actually ran.
    const movedSettings = runtimeStub({
      settings: {
        experimentalNativeChat: false,
        experimentalStructuredNativeChat: false,
        openAgentTabsInChatByDefault: false
      }
    })
    const replayed = await launch(params, movedSettings, PAIRED_CLIENT)

    expect(replayed).toEqual(first)
    expect(replayed.receipt.preferred).toBe('structured')
    expect(replayed.warning).toBe('Could not copy untracked files.')
    expect(replayed.prompt).toEqual({ delivery: 'draft', delivered: false })
    expect(movedSettings.createManagedWorktree).not.toHaveBeenCalled()
  })

  it('survives a host restart, because the record is on disk', async () => {
    const runtime = runtimeStub()
    const params = createLaunch({ operationId: OPERATION_ID })
    const first = await launch(params, runtime)

    const reopened = await AgentSessionRecordStore.open({ directory, hostId: 'local' })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see the setup above.
    setStructuredAgentSessionHost({
      deps: { store: reopened }
    } as unknown as StructuredAgentSessionHost)
    const afterRestart = runtimeStub()

    expect(await launch(params, afterRestart)).toEqual(first)
    expect(afterRestart.createManagedWorktree).not.toHaveBeenCalled()
  })

  it('refuses a retry that changed what it asks for, and creates nothing', async () => {
    const runtime = runtimeStub()
    await launch(createLaunch({ operationId: OPERATION_ID }), runtime)

    const conflicting = runtimeStub()
    await expect(
      launch(
        createLaunch({
          operationId: OPERATION_ID,
          target: { kind: 'create-worktree', create: { repo: 'id:repo-1', name: 'other' } }
        }),
        conflicting
      )
    ).rejects.toThrow('agent_session_operation_conflict')
    expect(conflicting.createManagedWorktree).not.toHaveBeenCalled()
    expect(conflicting.createTerminal).not.toHaveBeenCalled()
  })
})

describe('an uncertain launch stays uncertain', () => {
  it('refuses an operation left at unknown, and never falls back to launching again', async () => {
    const params = createLaunch({ operationId: OPERATION_ID })
    await store.admitOperation({
      callerKey: 'device-1',
      operationId: OPERATION_ID,
      // The host's own digest, so the retry passes the fingerprint check and is refused for the
      // reason under test rather than for disagreeing about what it asked for.
      fingerprint: computeAgentLaunchFingerprint(params),
      now: NOW
    })
    await store.claimOperation({ callerKey: 'device-1', operationId: OPERATION_ID })

    const runtime = runtimeStub()
    await expect(launch(params, runtime)).rejects.toThrow('agent_session_operation_unknown')
    expect(runtime.createManagedWorktree).not.toHaveBeenCalled()
    expect(runtime.createTerminal).not.toHaveBeenCalled()
    expect(createStructuredSession).not.toHaveBeenCalled()
  })

  it('leaves the row at unknown when the launch itself throws past the claim', async () => {
    const runtime = runtimeStub()
    runtime.createManagedWorktree.mockRejectedValueOnce(new Error('worktree_create_failed'))

    await expect(launch(createLaunch({ operationId: OPERATION_ID }), runtime)).rejects.toThrow(
      'worktree_create_failed'
    )
    expect(rowFor(OPERATION_ID)?.outcome.status).toBe('unknown')
  })

  it('records a failure that happened before anything could be created', async () => {
    const runtime = runtimeStub()
    runtime.showManagedTerminalWorkspace.mockRejectedValueOnce(new Error('worktree_not_found'))

    await expect(
      launch(
        createLaunch({ operationId: OPERATION_ID, target: { kind: 'existing', worktree: 'gone' } }),
        runtime
      )
    ).rejects.toThrow('worktree_not_found')
    expect(rowFor(OPERATION_ID)?.outcome).toMatchObject({
      status: 'failed',
      code: 'worktree_not_found'
    })
  })
})

describe('settlement is monotone', () => {
  it('does not let a late unknown clobber a recorded success', () => {
    const succeeded: AgentSessionOperationRow = {
      callerKey: 'device-1',
      operationId: OPERATION_ID,
      fingerprint: 'fp-1',
      operationTimestamp: NOW,
      recordedAt: NOW,
      expiresAt: NOW + 1,
      outcome: { status: 'succeeded', sessionId: 'sess-1' }
    }
    const rows = new Map([[`device-1 ${OPERATION_ID}`, succeeded]])

    const settled = settleAgentSessionOperation(rows, {
      callerKey: 'device-1',
      operationId: OPERATION_ID,
      outcome: { status: 'unknown' }
    })

    expect([...settled.values()][0].outcome).toEqual({ status: 'succeeded', sessionId: 'sess-1' })
  })

  it('still lets a claim take a pending row, which is the one state it may take', () => {
    const pending: AgentSessionOperationRow = {
      callerKey: 'device-1',
      operationId: OPERATION_ID,
      fingerprint: 'fp-1',
      operationTimestamp: NOW,
      recordedAt: NOW,
      expiresAt: NOW + 1,
      outcome: { status: 'pending' }
    }
    const rows = new Map([[`device-1 ${OPERATION_ID}`, pending]])

    const claimed = claimAgentSessionOperation(rows, {
      callerKey: 'device-1',
      operationId: OPERATION_ID
    })

    expect(claimed.claim.claim).toBe('won')
    expect([...claimed.rows.values()][0].outcome).toEqual({ status: 'unknown' })
  })
})

describe('the recorded row stays readable by a build that predates it', () => {
  it('writes a launch success as a succeeded row with a string sessionId', async () => {
    // A terminal launch: the surface has a handle and no session id, which is the case that would
    // tempt a new outcome status or an optional field.
    await launch(
      createLaunch({
        agent: 'codex',
        operationId: OPERATION_ID,
        target: { kind: 'existing', worktree: 'id:wt-7' }
      }),
      runtimeStub({ createSupport: { supported: false, reason: 'agent' } })
    )

    const file: { operations: Record<string, { outcome: Record<string, unknown> }> } = JSON.parse(
      await readFile(agentSessionStorePath(directory), 'utf-8')
    )
    const outcome = Object.values(file.operations)[0].outcome

    // The ratchet, and the reason this is not a new status arm or an optional `sessionId`: a build
    // without `launch` validates a row by these two fields, one row it rejects returns null for the
    // whole file, and the schema version cannot be bumped to excuse it — a store is unreadable to
    // any build whose version is higher than the file's. A downgrade must skip what it cannot
    // understand, not lose every lease.
    expect(outcome.status).toBe('succeeded')
    expect(typeof outcome.sessionId).toBe('string')
    expect(outcome.launch).toMatchObject({ outcome: { kind: 'terminal' } })
  })
})

describe('a client that names no operation keeps today behaviour', () => {
  it('runs the launch and writes no ledger row at all', async () => {
    const runtime = runtimeStub()
    await launch(createLaunch(), runtime)

    expect(runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(store.listOperationRows()).toHaveLength(0)
  })

  it('still dedupes a repeated create through the in-memory mutation-id cache', async () => {
    const runtime = runtimeStub()
    const params = createLaunch({
      target: {
        kind: 'create-worktree',
        create: { repo: 'id:repo-1', name: 'task', clientMutationId: 'launch-1' }
      }
    })

    const [first, second] = await Promise.all([launch(params, runtime), launch(params, runtime)])

    expect(first).toEqual(second)
    expect(runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(store.listOperationRows()).toHaveLength(0)
  })
})

describe('the inner attach reserves under its own id', () => {
  it('does not conflict with its own launch when both share a caller key', async () => {
    const runtime = runtimeStub()
    // An existing workspace: a create-worktree launch additionally demands a paired device
    // identity, and the bearer-identity shape under test here has none.
    const params = createLaunch({
      operationId: OPERATION_ID,
      target: { kind: 'existing', worktree: 'id:wt-7' }
    })

    // The bearer-identity shape is the one where the launch's caller key and the attach's caller
    // key derive to the same string, so a forwarded id would meet the launch's own row.
    const result = await launch(params, runtime, BEARER_CLIENT)

    expect(result.outcome).toEqual({
      kind: 'structured',
      sessionId: 'sess-1',
      handle: expect.any(String)
    })
    expect(attachOperationIds).toHaveLength(1)
    expect(attachOperationIds[0]).not.toBe(OPERATION_ID)
    expect(attachOperationIds[0]).toBe(deriveAgentLaunchChildOperationId(OPERATION_ID))
  })

  it('ABLATION: forwarding the launch id unchanged makes the attach refuse a conflict', async () => {
    const callerKey = 'client-9'
    await store.admitOperation({
      callerKey,
      operationId: OPERATION_ID,
      fingerprint: 'launch-fingerprint',
      now: NOW
    })

    // What the attach does with whatever id it is handed: reserve in the same ledger, under the
    // same caller, with its own attach fingerprint.
    const forwarded = await store.admitOperation({
      callerKey,
      operationId: OPERATION_ID,
      fingerprint: 'attach-fingerprint',
      now: NOW
    })
    expect(forwarded).toEqual({
      decision: 'refused',
      code: 'agent_session_operation_conflict'
    })

    const derived = deriveAgentLaunchChildOperationId(OPERATION_ID)
    if (derived === null) {
      throw new Error('the launch id must derive a child id')
    }
    const child = await store.admitOperation({
      callerKey,
      operationId: derived,
      fingerprint: 'attach-fingerprint',
      now: NOW
    })
    expect(child.decision).toBe('admit')
  })
})
