import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  startStructuredAgentLaunch: vi.fn(),
  cancelStructuredAgentLaunch: vi.fn(),
  retireStructuredAgentSessionSurface:
    vi.fn<(worktreeId: string, sessionId: string) => Promise<void>>()
}))

vi.mock('@/lib/structured-agent-session-launch', () => ({
  startStructuredAgentLaunch: mocks.startStructuredAgentLaunch,
  cancelStructuredAgentLaunch: mocks.cancelStructuredAgentLaunch
}))

vi.mock('@/lib/launch-structured-agent-session', () => ({
  StructuredAgentSessionCreateRefusalError: class extends Error {}
}))

vi.mock('@/lib/structured-agent-session-surface-retirement', () => ({
  retireStructuredAgentSessionSurface: mocks.retireStructuredAgentSessionSurface
}))

import { StructuredAgentSessionCreateRefusalError } from '@/lib/launch-structured-agent-session'
import {
  settleStructuredAgentLaunch,
  structuredAgentLegacyFallbackFromSettlement,
  type StructuredAgentLaunchDeadlineClock
} from './structured-agent-launch-settlement'

type FakeLaunch = {
  launchResult: Promise<unknown>
  visibilityUnknown?: boolean
  promptDeliveryResult?: Promise<{ delivered: boolean; failureNotified: boolean }>
}

/** Mirrors the callers layer: the claim runs the callback once the launch is refused and resolves
 *  with whether it ran; a non-refusal settlement resolves it false without running it. */
function fakeLaunch(args: FakeLaunch) {
  const releaseCallerAfterUnknownOutcome = vi.fn(() => true)
  const runFallback = new Map<string, () => Promise<void>>()
  let fallbackStarted = false
  const claimFallback = vi.fn<
    (fallback: () => Promise<void>, reason?: 'refusal' | 'deadline') => Promise<boolean>
  >((fallback: () => Promise<void>, reason: 'refusal' | 'deadline' = 'refusal') => {
    runFallback.set('fallback', fallback)
    const runOnce = (): Promise<void> => {
      if (fallbackStarted) {
        return Promise.resolve()
      }
      fallbackStarted = true
      return runFallback.get('fallback')!()
    }
    if (reason === 'deadline') {
      return Promise.resolve()
        .then(runOnce)
        .then(() => true)
    }
    return args.launchResult.then(
      () => false,
      (error) =>
        error instanceof StructuredAgentSessionCreateRefusalError
          ? Promise.resolve()
              .then(runOnce)
              .then(() => true)
          : false
    )
  })
  mocks.startStructuredAgentLaunch.mockReturnValue({
    sessionId: 'session-1',
    launchResult: args.launchResult,
    ...(args.promptDeliveryResult ? { promptDeliveryResult: args.promptDeliveryResult } : {}),
    isVisibilityUnknown: () => args.visibilityUnknown === true,
    releaseCallerAfterUnknownOutcome,
    claimFallback,
    claimDefinitiveRefusalFallback: claimFallback
  })
  return {
    releaseCallerAfterUnknownOutcome,
    claimDefinitiveRefusalFallback: claimFallback,
    claimFallback
  }
}

const fallbackResult = {
  activation: { primaryTabId: 'fallback-tab' },
  primaryTabId: 'fallback-tab'
}

/** A caller-side cancel signal: `fire` is what the caller's store subscription would abort on. */
function fakeCancellation(initiallyCancelled = false) {
  const controller = new AbortController()
  if (initiallyCancelled) {
    controller.abort()
  }
  const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')
  return {
    /** The loop must drop its listener on settle, not leave the signal holding the closure. */
    removeEventListener,
    fire: () => controller.abort(),
    signal: controller.signal
  }
}

function fakeClock(): { clock: StructuredAgentLaunchDeadlineClock; fire: () => void } {
  let callback: (() => void) | null = null
  return {
    clock: {
      setTimeout: (next) => {
        callback = next
        return next
      },
      clearTimeout: () => {
        callback = null
      }
    },
    fire: () => callback?.()
  }
}

describe('settleStructuredAgentLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.retireStructuredAgentSessionSurface.mockResolvedValue()
  })

  it.each(['refused-then-legacy', 'deadline-then-legacy'] as const)(
    'normalizes %s into the shared legacy fallback result',
    (kind) => {
      expect(structuredAgentLegacyFallbackFromSettlement({ kind, ...fallbackResult })).toEqual(
        expect.objectContaining(fallbackResult)
      )
    }
  )

  it('returns structured and activates once the launch is published', async () => {
    const promptDeliveryResult = Promise.resolve({ delivered: true, failureNotified: false })
    fakeLaunch({
      launchResult: Promise.resolve({ sessionId: 'session-1', fence: 1 }),
      promptDeliveryResult
    })
    const onStructuredReady = vi.fn()
    const legacyFallback = vi.fn()

    await expect(
      settleStructuredAgentLaunch(
        'worktree-1',
        'codex',
        { prompt: 'Fix' },
        {
          legacyFallback,
          onStructuredReady
        }
      )
    ).resolves.toEqual({ kind: 'structured', sessionId: 'session-1', promptDeliveryResult })
    expect(mocks.startStructuredAgentLaunch).toHaveBeenCalledWith('worktree-1', 'codex', {
      prompt: 'Fix'
    })
    expect(onStructuredReady).toHaveBeenCalledWith('session-1')
    expect(legacyFallback).not.toHaveBeenCalled()
  })

  it('runs the legacy fallback exactly once after a definitive refusal', async () => {
    fakeLaunch({
      launchResult: Promise.reject(new StructuredAgentSessionCreateRefusalError('unsupported'))
    })
    const legacyFallback = vi
      .fn<() => Promise<typeof fallbackResult>>()
      .mockResolvedValue(fallbackResult)
    const onStructuredReady = vi.fn()

    await expect(
      settleStructuredAgentLaunch('worktree-1', 'codex', {}, { legacyFallback, onStructuredReady })
    ).resolves.toEqual({ kind: 'refused-then-legacy', ...fallbackResult })
    expect(legacyFallback).toHaveBeenCalledOnce()
    expect(onStructuredReady).not.toHaveBeenCalled()
  })

  it('carries a fallback that opened a tab without activating a workspace', async () => {
    fakeLaunch({
      launchResult: Promise.reject(new StructuredAgentSessionCreateRefusalError('unsupported'))
    })
    const promptDeliveryResult = Promise.resolve({ delivered: true, failureNotified: false })
    const legacyFallback = vi
      .fn()
      .mockResolvedValue({ primaryTabId: 'new-tab', promptDeliveryResult })

    await expect(
      settleStructuredAgentLaunch('worktree-1', 'codex', {}, { legacyFallback })
    ).resolves.toEqual({
      kind: 'refused-then-legacy',
      primaryTabId: 'new-tab',
      promptDeliveryResult
    })
  })

  it('fails a refusal that has no legacy equivalent without claiming a fallback', async () => {
    const error = new StructuredAgentSessionCreateRefusalError('unsupported')
    const { claimDefinitiveRefusalFallback } = fakeLaunch({ launchResult: Promise.reject(error) })

    await expect(settleStructuredAgentLaunch('worktree-1', 'codex', {}, {})).resolves.toEqual({
      kind: 'failed',
      error
    })
    // Why: a claimed no-op would tell the launch layer a terminal fallback was attempted.
    expect(claimDefinitiveRefusalFallback).not.toHaveBeenCalled()
  })

  it('reports the surface of a legacy fallback that finished before the cancel', async () => {
    fakeLaunch({
      launchResult: Promise.reject(new StructuredAgentSessionCreateRefusalError('unsupported'))
    })
    const cancellation = fakeCancellation()
    let finishFallback!: () => void
    const legacyFallback = vi.fn(
      () =>
        new Promise<typeof fallbackResult>((resolve) => {
          finishFallback = () => resolve(fallbackResult)
        })
    )

    const settlement = settleStructuredAgentLaunch(
      'worktree-1',
      'codex',
      {},
      { legacyFallback, signal: cancellation.signal }
    )
    await vi.waitFor(() => expect(legacyFallback).toHaveBeenCalledOnce())
    cancellation.fire()
    finishFallback()

    // Why: the fallback's terminal outlives the cancel, so its tab is the caller's real surface.
    await expect(settlement).resolves.toEqual({
      kind: 'cancelled',
      sessionId: 'session-1',
      fallback: fallbackResult
    })
    expect(mocks.cancelStructuredAgentLaunch).toHaveBeenCalledExactlyOnceWith(
      'worktree-1',
      'session-1'
    )
  })

  it('fails when the legacy fallback itself throws', async () => {
    const fallbackError = new Error('no terminal')
    fakeLaunch({
      launchResult: Promise.reject(new StructuredAgentSessionCreateRefusalError('unsupported'))
    })
    const legacyFallback = vi.fn().mockRejectedValue(fallbackError)

    await expect(
      settleStructuredAgentLaunch('worktree-1', 'codex', {}, { legacyFallback })
    ).resolves.toEqual({ kind: 'failed', error: fallbackError })
  })

  it('reports an unknown outcome, releases the caller, and never runs the fallback', async () => {
    const { releaseCallerAfterUnknownOutcome } = fakeLaunch({
      launchResult: Promise.reject(new Error('connection lost')),
      visibilityUnknown: true
    })
    const legacyFallback = vi.fn()

    await expect(
      settleStructuredAgentLaunch('worktree-1', 'codex', {}, { legacyFallback })
    ).resolves.toEqual({ kind: 'visibility-unknown', sessionId: 'session-1' })
    expect(releaseCallerAfterUnknownOutcome).toHaveBeenCalledOnce()
    expect(legacyFallback).not.toHaveBeenCalled()
  })

  it('fails a non-refusal error whose outcome is known', async () => {
    const error = new Error('boom')
    const { releaseCallerAfterUnknownOutcome } = fakeLaunch({ launchResult: Promise.reject(error) })
    const legacyFallback = vi.fn()

    await expect(
      settleStructuredAgentLaunch('worktree-1', 'codex', {}, { legacyFallback })
    ).resolves.toEqual({ kind: 'failed', error })
    expect(releaseCallerAfterUnknownOutcome).not.toHaveBeenCalled()
    expect(legacyFallback).not.toHaveBeenCalled()
  })

  it('returns cancelled after a successful launch without activating', async () => {
    fakeLaunch({ launchResult: Promise.resolve({ sessionId: 'session-1', fence: 1 }) })
    const onStructuredReady = vi.fn()

    await expect(
      settleStructuredAgentLaunch(
        'worktree-1',
        'codex',
        {},
        {
          onStructuredReady,
          signal: fakeCancellation(true).signal
        }
      )
    ).resolves.toEqual({ kind: 'cancelled', sessionId: 'session-1' })
    expect(onStructuredReady).not.toHaveBeenCalled()
  })

  it('returns cancelled after a refusal without running the fallback', async () => {
    fakeLaunch({
      launchResult: Promise.reject(new StructuredAgentSessionCreateRefusalError('unsupported'))
    })
    const legacyFallback = vi
      .fn<() => Promise<typeof fallbackResult>>()
      .mockResolvedValue(fallbackResult)

    await expect(
      settleStructuredAgentLaunch(
        'worktree-1',
        'codex',
        {},
        {
          legacyFallback,
          signal: fakeCancellation(true).signal
        }
      )
    ).resolves.toEqual({ kind: 'cancelled', sessionId: 'session-1' })
    expect(legacyFallback).not.toHaveBeenCalled()
  })

  it('cancels the launch eagerly, once, before the launch settles', async () => {
    let resolveLaunch!: (receipt: { sessionId: string; fence: number }) => void
    fakeLaunch({
      launchResult: new Promise((resolve) => {
        resolveLaunch = resolve
      })
    })
    const cancellation = fakeCancellation()
    const onStructuredReady = vi.fn()

    const settlement = settleStructuredAgentLaunch(
      'worktree-1',
      'codex',
      {},
      { onStructuredReady, signal: cancellation.signal }
    )
    expect(mocks.cancelStructuredAgentLaunch).not.toHaveBeenCalled()
    cancellation.fire()
    cancellation.fire()
    expect(mocks.cancelStructuredAgentLaunch).toHaveBeenCalledExactlyOnceWith(
      'worktree-1',
      'session-1'
    )
    expect(cancellation.removeEventListener).not.toHaveBeenCalled()

    resolveLaunch({ sessionId: 'session-1', fence: 1 })
    await expect(settlement).resolves.toEqual({ kind: 'cancelled', sessionId: 'session-1' })
    expect(onStructuredReady).not.toHaveBeenCalled()
    expect(cancellation.removeEventListener).toHaveBeenCalledOnce()
  })

  it('honours a cancellation that fired before the loop subscribed', async () => {
    fakeLaunch({ launchResult: Promise.resolve({ sessionId: 'session-1', fence: 1 }) })
    const cancellation = fakeCancellation(true)

    const settlement = settleStructuredAgentLaunch(
      'worktree-1',
      'codex',
      {},
      { signal: cancellation.signal }
    )
    expect(mocks.cancelStructuredAgentLaunch).toHaveBeenCalledExactlyOnceWith(
      'worktree-1',
      'session-1'
    )
    await expect(settlement).resolves.toEqual({ kind: 'cancelled', sessionId: 'session-1' })
    expect(cancellation.removeEventListener).toHaveBeenCalledOnce()
  })

  it('unsubscribes from the cancel signal once a launch settles without cancelling', async () => {
    fakeLaunch({ launchResult: Promise.resolve({ sessionId: 'session-1', fence: 1 }) })
    const cancellation = fakeCancellation()

    await expect(
      settleStructuredAgentLaunch('worktree-1', 'codex', {}, { signal: cancellation.signal })
    ).resolves.toEqual({ kind: 'structured', sessionId: 'session-1' })
    expect(mocks.cancelStructuredAgentLaunch).not.toHaveBeenCalled()
    expect(cancellation.removeEventListener).toHaveBeenCalledOnce()
  })

  it('uses the single fallback claim when the launch reaches its deadline', async () => {
    const clock = fakeClock()
    const launchResult = new Promise<never>(() => {})
    const { claimFallback } = fakeLaunch({ launchResult })
    const legacyFallback = vi
      .fn<() => Promise<typeof fallbackResult>>()
      .mockResolvedValue(fallbackResult)
    const settlement = settleStructuredAgentLaunch(
      'worktree-1',
      'codex',
      {},
      { legacyFallback, clock: clock.clock, deadlineMs: 10 }
    )

    clock.fire()

    await expect(settlement).resolves.toEqual({
      kind: 'deadline-then-legacy',
      ...fallbackResult
    })
    expect(legacyFallback).toHaveBeenCalledOnce()
    expect(claimFallback).toHaveBeenCalledWith(expect.any(Function), 'deadline')
  })

  it('does not run the fallback when a launch settles before its deadline', async () => {
    const clock = fakeClock()
    const legacyFallback = vi
      .fn<() => Promise<typeof fallbackResult>>()
      .mockResolvedValue(fallbackResult)
    fakeLaunch({ launchResult: Promise.resolve({ sessionId: 'session-1', fence: 1 }) })

    await expect(
      settleStructuredAgentLaunch(
        'worktree-1',
        'codex',
        {},
        { legacyFallback, clock: clock.clock, deadlineMs: 10 }
      )
    ).resolves.toEqual({ kind: 'structured', sessionId: 'session-1' })
    clock.fire()
    expect(legacyFallback).not.toHaveBeenCalled()
  })

  it('keeps a definitive refusal and a deadline single-shot', async () => {
    const clock = fakeClock()
    let rejectLaunch!: (error: unknown) => void
    const launchResult = new Promise<never>((_, reject) => {
      rejectLaunch = reject
    })
    const { claimFallback } = fakeLaunch({ launchResult })
    const legacyFallback = vi
      .fn<() => Promise<typeof fallbackResult>>()
      .mockResolvedValue(fallbackResult)
    const settlement = settleStructuredAgentLaunch(
      'worktree-1',
      'codex',
      {},
      { legacyFallback, clock: clock.clock, deadlineMs: 10 }
    )
    clock.fire()
    rejectLaunch(new StructuredAgentSessionCreateRefusalError('unsupported'))

    await expect(settlement).resolves.toEqual({
      kind: 'deadline-then-legacy',
      ...fallbackResult
    })
    expect(legacyFallback).toHaveBeenCalledOnce()
    expect(claimFallback).toHaveBeenCalledTimes(2)
  })

  it('lets cancellation win over a fired deadline', async () => {
    const clock = fakeClock()
    let resolveLaunch!: (receipt: { sessionId: string; fence: number }) => void
    const launchResult = new Promise<{ sessionId: string; fence: number }>((resolve) => {
      resolveLaunch = resolve
    })
    fakeLaunch({ launchResult })
    const cancellation = fakeCancellation()
    const legacyFallback = vi
      .fn<() => Promise<typeof fallbackResult>>()
      .mockResolvedValue(fallbackResult)
    const settlement = settleStructuredAgentLaunch(
      'worktree-1',
      'codex',
      {},
      { legacyFallback, signal: cancellation.signal, clock: clock.clock, deadlineMs: 10 }
    )
    cancellation.fire()
    clock.fire()
    resolveLaunch({ sessionId: 'session-1', fence: 1 })

    await expect(settlement).resolves.toEqual({ kind: 'cancelled', sessionId: 'session-1' })
    expect(legacyFallback).not.toHaveBeenCalled()
  })

  it('retires a structured result that arrives after the fallback surface', async () => {
    const clock = fakeClock()
    let resolveLaunch!: (receipt: { sessionId: string; fence: number }) => void
    const launchResult = new Promise<{ sessionId: string; fence: number }>((resolve) => {
      resolveLaunch = resolve
    })
    fakeLaunch({ launchResult })
    const legacyFallback = vi
      .fn<() => Promise<typeof fallbackResult>>()
      .mockResolvedValue(fallbackResult)
    const settlement = settleStructuredAgentLaunch(
      'worktree-1',
      'codex',
      {},
      {
        legacyFallback,
        clock: clock.clock,
        deadlineMs: 10
      }
    )
    clock.fire()
    await expect(settlement).resolves.toMatchObject({ kind: 'deadline-then-legacy' })
    resolveLaunch({ sessionId: 'session-1', fence: 1 })
    await vi.waitFor(() =>
      expect(mocks.retireStructuredAgentSessionSurface).toHaveBeenCalledWith(
        'worktree-1',
        'session-1'
      )
    )
  })
})
