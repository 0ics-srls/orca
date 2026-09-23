// A session that published and then lost its child before startup (not signed in, say) keeps a
// released lease and a chat the user can still type into. The send is the user asking for the
// child back: the host restarts it before admitting the write, instead of parking the message
// behind a lease nothing would ever re-acquire.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { AgentSessionMutationEnvelope } from '../../../shared/agent-session-wire'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestAttachParams,
  hostTestMessage,
  hostTestOperationId,
  resetHostTestOperationIds
} from './structured-agent-session-host-test-data'

const CALLER = { callerKey: 'client-1' }
const EXIT_REASON = 'Claude Code is not signed in. Sign in with the Claude CLI'

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost
let acquire: Mock<StructuredAgentSessionAdapter['acquire']>
let generation = 0

function sendEnvelope(
  fence: number,
  body: ReturnType<typeof hostTestMessage>
): AgentSessionMutationEnvelope {
  return {
    sessionId: SESSION,
    clientOperationId: hostTestOperationId(),
    expectedRuntimeFence: fence,
    payloadFingerprint: computeAgentSessionPayloadFingerprint({
      method: 'agentSession.send',
      sessionId: SESSION,
      fields: { body }
    })
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-send-after-failed-start-'))
  resetHostTestOperationIds()
  generation = 0
  acquire = vi.fn(async ({ fence, spawnToken }) => ({
    process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
    link: {
      linkId: `link-${fence}`,
      handle: { provider: 'codex', threadId: THREAD },
      // A re-acquire resumes the thread the first child minted, as a real adapter does.
      origin: generation === 0 ? ('created' as const) : ('resumed' as const),
      mintedAtFence: fence,
      observedAt: NOW
    },
    acquisitionGeneration: `generation-${++generation}`,
    providerChildPhase: 'starting' as const
  }))
  store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
  host = new StructuredAgentSessionHost({
    store,
    adapter: {
      acquire,
      releaseAcquisition: vi.fn(async () => true),
      dispatch: vi.fn(async () => ({ state: 'admitted' as const })),
      cancelTurn: vi.fn(async () => ({ cancelled: true })),
      answerPrompt: vi.fn(async () => undefined),
      setOption: vi.fn(async () => undefined)
    },
    journalRoot: root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => `spawn-${generation + 1}`,
    now: () => NOW
  })
})

afterEach(async () => {
  await host.flushAllStreamedEvents()
  await rm(root, { recursive: true, force: true })
})

describe('a send into a published session whose child ended before startup', () => {
  it('restarts the child and admits the message once the resume has published', async () => {
    await expect(host.attach(CALLER, hostTestAttachParams(null))).resolves.toMatchObject({
      ok: true
    })
    const startedFence = store.getRecord(SESSION)?.lease.runtimeFence ?? 0
    await host.handleAdapterEvent({
      type: 'ended',
      sessionId: SESSION,
      reason: EXIT_REASON,
      cause: 'unexpected-exit',
      fence: startedFence,
      acquisitionGeneration: 'generation-1',
      startupUnproven: true
    })
    // The failed start released the lease and no resume ran on its own.
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('released')
    expect(acquire).toHaveBeenCalledOnce()
    const releasedFence = store.getRecord(SESSION)?.lease.runtimeFence ?? 0

    const body = hostTestMessage('hello again')
    const first = await host.send(CALLER, { envelope: sendEnvelope(releasedFence, body), body })
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('live')
    // The resume reserved a new fence, so this send is answered stale with the fence it published;
    // the client's outbox re-drives under it, exactly as after any other fence change.
    expect(first, JSON.stringify(first)).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_checkpoint_stale', currentFence: expect.any(Number) }
    })
    const current = first.ok ? 0 : (first.refusal.currentFence ?? 0)
    expect(current).toBeGreaterThan(releasedFence)

    await expect(
      host.send(CALLER, { envelope: sendEnvelope(current, body), body })
    ).resolves.toMatchObject({ ok: true, value: { submission: { dispatchState: 'pending' } } })
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it('leaves a send against a live child alone', async () => {
    await host.attach(CALLER, hostTestAttachParams(null))
    const fence = store.getRecord(SESSION)?.lease.runtimeFence ?? 0
    const body = hostTestMessage('hello')
    await expect(
      host.send(CALLER, { envelope: sendEnvelope(fence, body), body })
    ).resolves.toMatchObject({ ok: true })
    expect(acquire).toHaveBeenCalledOnce()
  })
})
