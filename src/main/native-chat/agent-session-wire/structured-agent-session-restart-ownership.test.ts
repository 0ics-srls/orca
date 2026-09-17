import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import { restartContinuationEnvelope } from './structured-agent-session-restart-continuation'
import { STRUCTURED_AGENT_SESSION_RESTART_CONTINUATION_CALLER } from './structured-agent-session-restart-resume-wiring'
import {
  adapter,
  attach,
  hostTestState,
  replaceHostTestState
} from './structured-agent-session-host-test-harness'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD
} from './structured-agent-session-host-test-data'

const GRACE = 15_000

async function interruptedRestart() {
  const previous = hostTestState()
  await attach()
  const events = previous.acquire.mock.calls[0]?.[0].events
  if (!events) {
    throw new Error('missing provider event sink')
  }
  events.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'interrupted-turn', ordinal: 1 },
    { kind: 'turn', turnId: 'interrupted-turn', state: 'running' }
  )
  await previous.host.flushStreamedEvents(SESSION)
  await previous.host.flushAllStreamedEvents()
  const store = await AgentSessionRecordStore.open({
    directory: join(previous.root, 'store'),
    hostId: 'local'
  })
  const closeSession = vi.fn(async () => true)
  const host = new StructuredAgentSessionHost({
    store,
    adapter: { ...adapter(), closeSession },
    journalRoot: previous.root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-next',
    probeOwner: async () => ({ outcome: 'pid-absent' }),
    launchGeneration: { current: 'next', previous: 'unproven' },
    releaseGraceMs: GRACE,
    now: () => NOW
  })
  replaceHostTestState({ store, host })
  previous.acquire.mockClear()
  previous.releaseAcquisition.mockClear()
  return { ...hostTestState(), host, store, closeSession }
}

afterEach(() => vi.useRealTimers())

it('replays the same logical continuation through the durable send ledger', async () => {
  const { host, store, dispatch } = await interruptedRestart()
  const marker = store.resumeMarkers.list(NOW)[0]
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
    const { host, store, acquire, dispatch } = await interruptedRestart()
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
    expect(store.resumeMarkers.list(NOW)).toEqual([])
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
