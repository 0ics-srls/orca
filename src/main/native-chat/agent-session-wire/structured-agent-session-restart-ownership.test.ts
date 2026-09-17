import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import {
  AgentSessionRecoveryCapsule,
  AGENT_SESSION_RECOVERY_CAPSULE_FILE
} from '../../runtime/agent-session-recovery-capsule'
import { parseAgentSessionResumeMarker } from '../../../shared/agent-session-resume-marker'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import { restartContinuationEnvelope } from './structured-agent-session-restart-continuation'
import { STRUCTURED_AGENT_SESSION_RESTART_CONTINUATION_CALLER } from './structured-agent-session-restart-resume-wiring'
import {
  adapter,
  attach,
  CALLER,
  envelope,
  hostTestState,
  replaceHostTestState
} from './structured-agent-session-host-test-harness'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestMessage
} from './structured-agent-session-host-test-data'

const GRACE = 15_000

async function interruptedRestart(
  work: 'turn' | 'submission' = 'turn',
  historyBoundaryConsistent = true
) {
  const previous = hostTestState()
  await attach()
  const events = previous.acquire.mock.calls[0]?.[0].events
  if (!events) {
    throw new Error('missing provider event sink')
  }
  if (work === 'submission') {
    previous.dispatch.mockResolvedValueOnce({ state: 'admitted' })
    const body = hostTestMessage('Perform the original task')
    await previous.host.send(CALLER, { envelope: envelope('agentSession.send', { body }), body })
  } else {
    events.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'interrupted-turn', ordinal: 1 },
      { kind: 'turn', turnId: 'interrupted-turn', state: 'running' }
    )
  }
  await previous.host.flushStreamedEvents(SESSION)
  await previous.host.flushAllStreamedEvents()
  const store = await AgentSessionRecordStore.open({
    directory: join(previous.root, 'store'),
    hostId: 'local'
  })
  const closeSession = vi.fn(async () => true)
  const host = new StructuredAgentSessionHost({
    store,
    adapter: {
      ...adapter(),
      closeSession,
      ...(work === 'submission'
        ? {
            providerHistoryWindow: async () => ({
              items: [],
              boundaryConsistent: historyBoundaryConsistent,
              turnInFlight: false
            })
          }
        : {})
    },
    journalRoot: previous.root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-next',
    probeOwner: async () => ({ outcome: 'pid-absent' }),
    recoveryCapsule: new AgentSessionRecoveryCapsule(previous.root),
    releaseGraceMs: GRACE,
    now: () => NOW
  })
  replaceHostTestState({ store, host })
  previous.acquire.mockClear()
  previous.releaseAcquisition.mockClear()
  previous.dispatch.mockClear()
  const capsule = JSON.parse(
    await readFile(join(previous.root, AGENT_SESSION_RECOVERY_CAPSULE_FILE), 'utf8')
  )
  const marker = parseAgentSessionResumeMarker(capsule.markers[0])
  return { ...hostTestState(), host, store, closeSession, marker }
}

afterEach(() => vi.useRealTimers())

it.each(['turn', 'submission'] as const)(
  'does not continue a marked %s after the user submits new work without a provider echo',
  async (work) => {
    const { host, dispatch } = await interruptedRestart(work, false)
    expect(await host.restartResume.list()).toHaveLength(1)
    await host.hold(SESSION, 'pane')
    dispatch.mockResolvedValueOnce({ state: 'admitted' })
    const body = hostTestMessage('Stop the old task and do this instead')
    await host.send(CALLER, { envelope: envelope('agentSession.send', { body }), body })
    await host.restartResume.continueAfterRestart([SESSION], 'modal')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(host.journalSnapshot(SESSION).submissions).toHaveLength(work === 'turn' ? 1 : 2)
    host.release(SESSION, 'pane')
    expect(host.isHeld(SESSION)).toBe(false)
  }
)

it('preserves the offer when the original submission receives its provider echo', async () => {
  const { host, acquire, dispatch } = await interruptedRestart('submission', false)
  expect(await host.restartResume.list()).toHaveLength(1)
  await host.hold(SESSION, 'pane')
  const events = acquire.mock.calls[0]?.[0].events
  if (!events) {
    throw new Error('missing resumed provider event sink')
  }
  events.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'original-turn', ordinal: 1 },
    hostTestMessage('Perform the original task')
  )
  await host.flushStreamedEvents(SESSION)
  expect(host.journalSnapshot(SESSION).submissions[0]?.dispatchState).toBe('accepted')
  expect(
    (await host.restartResume.continueAfterRestart([SESSION], 'modal')).continued
  ).toMatchObject([{ outcome: 'continued' }])
  expect(acquire).toHaveBeenCalledTimes(1)
  expect(dispatch).toHaveBeenCalledTimes(1)
  host.release(SESSION, 'pane')
  expect(host.isHeld(SESSION)).toBe(false)
})

it('does not continue work that acquisition proves was never delivered', async () => {
  const { host, acquire, dispatch } = await interruptedRestart('submission')
  expect(await host.restartResume.list()).toHaveLength(1)
  const result = await host.restartResume.continueAfterRestart([SESSION], 'modal')
  expect(host.journalSnapshot(SESSION).submissions[0]).toMatchObject({
    dispatchState: 'rejected',
    reason: 'not_delivered'
  })
  expect(acquire).toHaveBeenCalledTimes(1)
  expect(dispatch).not.toHaveBeenCalled()
  expect(result.resumed).toMatchObject([{ outcome: 'refused' }])
  expect(host.isHeld(SESSION)).toBe(false)
})

it.each(['turn', 'message'] as const)(
  'checks interrupted work at send admission after a newer %s supersedes it',
  async (newer) => {
    const { host, store, acquire, dispatch } = await interruptedRestart()
    expect(await host.restartResume.list()).toHaveLength(1)
    await host.hold(SESSION, 'pane')
    const events = acquire.mock.calls[0]?.[0].events
    if (!events) {
      throw new Error('missing resumed provider event sink')
    }
    const admitting = Promise.withResolvers<void>()
    const proceed = Promise.withResolvers<void>()
    const admit = store.admitMutationOperation
    vi.spyOn(store, 'admitMutationOperation').mockImplementationOnce(async (input) => {
      admitting.resolve()
      await proceed.promise
      return admit(input)
    })
    const continuing = host.restartResume.continueAfterRestart([SESSION], 'modal')
    await admitting.promise
    events.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'newer-turn', ordinal: 1 },
      newer === 'turn'
        ? { kind: 'turn', turnId: 'newer-turn', state: 'completed' }
        : hostTestMessage('A newer task from another client')
    )
    await host.flushStreamedEvents(SESSION)
    proceed.resolve()
    expect((await continuing).resumed).toMatchObject([
      { outcome: 'refused', reason: 'agent_session_restart_work_superseded' }
    ])
    expect(dispatch).not.toHaveBeenCalled()
    expect(host.journalSnapshot(SESSION).submissions).toHaveLength(0)
    host.release(SESSION, 'pane')
    expect(host.isHeld(SESSION)).toBe(false)
  }
)

it('refuses a completed turn even when its original delivery acknowledgement is unknown', async () => {
  const { host, store, acquire, dispatch } = await interruptedRestart('submission', false)
  expect(await host.restartResume.list()).toHaveLength(1)
  await host.hold(SESSION, 'pane')
  expect(host.journalSnapshot(SESSION).submissions[0]?.dispatchState).toBe('unknown')
  const events = acquire.mock.calls[0]?.[0].events
  if (!events) {
    throw new Error('missing resumed provider event sink')
  }
  const admitting = Promise.withResolvers<void>()
  const proceed = Promise.withResolvers<void>()
  const admit = store.admitMutationOperation
  vi.spyOn(store, 'admitMutationOperation').mockImplementationOnce(async (input) => {
    admitting.resolve()
    await proceed.promise
    return admit(input)
  })
  const continuing = host.restartResume.continueAfterRestart([SESSION], 'modal')
  await admitting.promise
  events.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'original-turn', ordinal: 1 },
    { kind: 'turn', turnId: 'original-turn', state: 'completed' }
  )
  await host.flushStreamedEvents(SESSION)
  proceed.resolve()
  expect((await continuing).resumed).toMatchObject([
    { outcome: 'refused', reason: 'agent_session_restart_work_superseded' }
  ])
  expect(dispatch).not.toHaveBeenCalled()
  expect(host.journalSnapshot(SESSION).submissions).toHaveLength(1)
  host.release(SESSION, 'pane')
  expect(host.isHeld(SESSION)).toBe(false)
})

it('replays the same logical continuation through the durable send ledger', async () => {
  const { host, store, dispatch, marker } = await interruptedRestart()
  if (!marker) {
    throw new Error('missing interrupted restart marker')
  }
  await host.restartResume.continueAfterRestart([SESSION], 'modal')
  const fence = store.getRecord(SESSION)?.lease.runtimeFence
  if (fence === undefined) {
    throw new Error('missing resumed lease')
  }
  const replay = await host.send(
    { callerKey: STRUCTURED_AGENT_SESSION_RESTART_CONTINUATION_CALLER },
    restartContinuationEnvelope(SESSION, fence, marker)
  )
  expect(replay).toMatchObject({ ok: true, replayed: true })
  expect(host.journalSnapshot(SESSION).submissions).toHaveLength(1)
  expect(dispatch).toHaveBeenCalledTimes(1)
})

it('releases a failed acquisition without retrying the spent offer', async () => {
  const { host, acquire, dispatch, closeSession } = await interruptedRestart()
  acquire.mockRejectedValueOnce(new Error('provider could not reconnect'))
  expect(await host.restartResume.resume([SESSION], 'modal')).toMatchObject([
    { outcome: 'refused' }
  ])
  expect(host.isHeld(SESSION)).toBe(false)
  await host.restartResume.continueAfterRestart([SESSION], 'retry')
  expect(acquire).toHaveBeenCalledTimes(1)
  expect(dispatch).not.toHaveBeenCalled()
  expect(closeSession).not.toHaveBeenCalled()
})

it.each([false, true])(
  'admits one durable continuation under concurrent calls (pane already live: %s)',
  async (alreadyLive) => {
    const { host, root, acquire, dispatch } = await interruptedRestart()
    if (alreadyLive) {
      expect(await host.restartResume.list()).toHaveLength(1)
      await host.hold(SESSION, 'pane')
    }
    const results = await Promise.all([
      host.restartResume.continueAfterRestart([SESSION], 'window-one'),
      host.restartResume.continueAfterRestart([SESSION], 'window-two')
    ])
    expect(
      results.flatMap((result) => result.resumed).filter((r) => r.outcome === 'resumed')
    ).toHaveLength(1)
    expect(
      results.flatMap((result) => result.continued).filter((r) => r.outcome === 'continued')
    ).toHaveLength(1)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(host.journalSnapshot(SESSION).submissions).toHaveLength(1)
    expect(await new AgentSessionRecoveryCapsule(root).take(NOW)).toEqual([])
    await host.restartResume.continueAfterRestart([SESSION], 'later-click')
    expect(dispatch).toHaveBeenCalledTimes(1)
    host.release(SESSION, 'pane')
  }
)

it.each([false, true])(
  'releases reconnect acquisition to idle eviction (pane: %s)',
  async (pane) => {
    const { host, acquire, dispatch, closeSession } = await interruptedRestart()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect(await host.restartResume.resume([SESSION], 'modal')).toMatchObject([
      { outcome: 'resumed' }
    ])
    expect(host.isHeld(SESSION)).toBe(false)
    if (pane) {
      await host.hold(SESSION, 'pane')
      await vi.advanceTimersByTimeAsync(GRACE * 2)
      expect(closeSession).not.toHaveBeenCalled()
      host.release(SESSION, 'pane')
    }
    await vi.advanceTimersByTimeAsync(GRACE)
    await vi.waitFor(() => expect(closeSession).toHaveBeenCalledTimes(1))
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()
  }
)

it('retains acquisition through slow continuation settlement, then releases it', async () => {
  const { host, dispatch, closeSession } = await interruptedRestart()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const settlement = Promise.withResolvers<Awaited<ReturnType<typeof dispatch>>>()
  const dispatched = Promise.withResolvers<void>()
  dispatch.mockImplementationOnce(() => {
    dispatched.resolve()
    return settlement.promise
  })
  const continuing = host.restartResume.continueAfterRestart([SESSION], 'modal')
  await dispatched.promise
  await vi.advanceTimersByTimeAsync(GRACE * 2)
  expect(host.isHeld(SESSION)).toBe(true)
  expect(closeSession).not.toHaveBeenCalled()
  settlement.resolve({ state: 'rejected', reason: 'provider refused' })
  expect((await continuing).continued).toMatchObject([{ outcome: 'refused' }])
  expect(host.isHeld(SESSION)).toBe(false)
  await vi.advanceTimersByTimeAsync(GRACE)
  await vi.waitFor(() => expect(closeSession).toHaveBeenCalledTimes(1))
  expect(dispatch).toHaveBeenCalledTimes(1)
})

it('shares one real-file take across concurrent first recovery requests', async () => {
  const { host, root } = await interruptedRestart()
  const take = vi.spyOn(AgentSessionRecoveryCapsule.prototype, 'take')
  const results = await Promise.all([host.restartResume.list(), host.restartResume.list()])
  expect(results.map((items) => items.length)).toEqual([1, 1])
  expect(take).toHaveBeenCalledTimes(1)
  expect(await new AgentSessionRecoveryCapsule(root).take(NOW)).toEqual([])
  take.mockRestore()
})

it('fails closed on corrupt recovery storage while ordinary hold and send still work', async () => {
  const { host, root, dispatch } = await interruptedRestart()
  await writeFile(join(root, AGENT_SESSION_RECOVERY_CAPSULE_FILE), '{')
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await host.restartResume.list()).toEqual([])
  expect(await host.restartResume.continueAfterRestart([SESSION], 'modal')).toEqual({
    resumed: [],
    continued: []
  })
  await host.hold(SESSION, 'pane')
  const body = hostTestMessage('A fresh ordinary request')
  expect(
    await host.send(CALLER, { envelope: envelope('agentSession.send', { body }), body })
  ).toMatchObject({ ok: true })
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(warning).toHaveBeenCalledTimes(1)
  warning.mockRestore()
  host.release(SESSION, 'pane')
})

it('logs teardown capsule publication failure and still releases the provider', async () => {
  const previous = hostTestState()
  await attach()
  const events = previous.acquire.mock.calls[0]?.[0].events
  if (!events) {
    throw new Error('missing provider event sink')
  }
  events.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'working', ordinal: 1 },
    { kind: 'turn', turnId: 'working', state: 'running' }
  )
  await previous.host.flushStreamedEvents(SESSION)
  const capsulePath = join(previous.root, AGENT_SESSION_RECOVERY_CAPSULE_FILE)
  await mkdir(capsulePath)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(previous.host.flushAllStreamedEvents()).resolves.toBeUndefined()
  expect(() => previous.host.journalSnapshot(SESSION)).toThrow('agent_session_ownership_unknown')
  expect(warning).toHaveBeenCalledWith(
    '[structured-agent-session] recording recovery capsule failed',
    expect.any(Error)
  )
  expect(previous.store.getRecord(SESSION)?.lease.claimStatus).toBe('released')
  warning.mockRestore()
  await rm(capsulePath, { recursive: true })
})
