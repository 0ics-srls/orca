import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StructuredAgentSessionHolds } from './structured-agent-session-holds'

const GRACE_MS = 15_000
const pendingHolds: StructuredAgentSessionHolds[] = []

function resumeHarness() {
  const resumeGate = Promise.withResolvers<void>()
  let child = false
  let turnActive = false
  const evict = vi.fn(async () => {
    child = false
  })
  const holds = new StructuredAgentSessionHolds({
    resume: async () => {
      await resumeGate.promise
      child = true
      return { fromFence: 1 }
    },
    hasProviderChild: () => child,
    isTurnActive: () => turnActive,
    evict,
    graceMs: GRACE_MS
  })
  pendingHolds.push(holds)
  return {
    holds,
    resumeGate,
    evict,
    hasChild: () => child,
    setTurnActive: (value: boolean) => {
      turnActive = value
    }
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const holds of pendingHolds.splice(0)) {
    holds.dispose()
  }
  vi.useRealTimers()
})

describe('a surface leaving while its structured session resumes', () => {
  it('releases the acquired child after the last surface disconnects during resume', async () => {
    const { holds, resumeGate, evict, hasChild } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')

    holds.release('session-1', 'connection-1:chat')
    expect(holds.isReleasePending('session-1')).toBe(false)
    resumeGate.resolve()
    await hold

    expect(hasChild()).toBe(true)
    expect(holds.isHeld('session-1')).toBe(false)
    expect(holds.isReleasePending('session-1')).toBe(true)
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1)
    expect(evict).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(evict).toHaveBeenCalledExactlyOnceWith('session-1')
    expect(hasChild()).toBe(false)
  })

  it('waits for an active turn before releasing the late child', async () => {
    const { holds, resumeGate, evict, setTurnActive } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    holds.release('session-1', 'connection-1:chat')
    setTurnActive(true)
    resumeGate.resolve()
    await hold

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(evict).not.toHaveBeenCalled()
    expect(holds.isReleasePending('session-1')).toBe(true)

    setTurnActive(false)
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(evict).toHaveBeenCalledExactlyOnceWith('session-1')
  })

  it.each([false, true])('preserves an arriving holder with resume=%s', async (resume) => {
    const { holds, resumeGate, evict } = resumeHarness()
    const first = holds.hold('session-1', 'connection-1:chat')
    holds.release('session-1', 'connection-1:chat')
    const replacement = holds.hold('session-1', 'connection-2:chat', { resume })
    resumeGate.resolve()
    await Promise.all([first, replacement])

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(holds.isHeld('session-1')).toBe(true)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()

    holds.release('session-1', 'connection-2:chat')
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(evict).toHaveBeenCalledExactlyOnceWith('session-1')
  })

  it('cancels the late-child release when a surface reconnects during grace', async () => {
    const { holds, resumeGate, evict } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    holds.release('session-1', 'connection-1:chat')
    resumeGate.resolve()
    await hold
    expect(holds.isReleasePending('session-1')).toBe(true)

    await holds.hold('session-1', 'connection-2:chat')
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()
  })

  it('preserves a failed resume without scheduling eviction', async () => {
    const { holds, resumeGate, evict, hasChild } = resumeHarness()
    const failure = new Error('provider acquisition failed')
    const hold = holds.hold('session-1', 'connection-1:chat')
    const rejected = expect(hold).rejects.toBe(failure)
    holds.release('session-1', 'connection-1:chat')
    resumeGate.reject(failure)
    await rejected

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(hasChild()).toBe(false)
    expect(holds.isHeld('session-1')).toBe(false)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()
  })

  it('leaves late acquisition cleanup to host teardown after disposal', async () => {
    const { holds, resumeGate, evict } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    holds.release('session-1', 'connection-1:chat')
    holds.dispose()
    resumeGate.resolve()
    await hold

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()
  })

  it('does not restart release timers when a surface leaves after disposal', async () => {
    const { holds, resumeGate, evict } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    resumeGate.resolve()
    await hold
    holds.dispose()
    holds.release('session-1', 'connection-1:chat')

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(holds.isHeld('session-1')).toBe(false)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()
  })

  it('releases a late child acquired after explicit close forgot its holders', async () => {
    const { holds, resumeGate, evict } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    holds.forget('session-1')
    resumeGate.resolve()
    await hold

    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(holds.isHeld('session-1')).toBe(false)
    expect(evict).toHaveBeenCalledExactlyOnceWith('session-1')
  })

  it('joins a pending resume for a holder that left and came back, and a failure releases it', async () => {
    const { holds, resumeGate, evict } = resumeHarness()
    const first = holds.hold('session-1', 'same-holder')
    const firstRejected = expect(first).rejects.toThrow('acquisition failed')
    holds.release('session-1', 'same-holder')
    const replacement = holds.hold('session-1', 'same-holder')
    const replacementRejected = expect(replacement).rejects.toThrow('acquisition failed')
    expect(holds.isHeld('session-1')).toBe(true)

    resumeGate.reject(new Error('acquisition failed'))
    await Promise.all([firstRejected, replacementRejected])

    expect(holds.isHeld('session-1')).toBe(false)
    expect(holds.isReleasePending('session-1')).toBe(false)
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(evict).not.toHaveBeenCalled()
  })

  it('starts a fresh resume once the failed one has settled', async () => {
    let child = false
    const resume = vi
      .fn<() => Promise<{ fromFence: number }>>()
      .mockRejectedValueOnce(new Error('first acquisition failed'))
      .mockImplementationOnce(async () => {
        child = true
        return { fromFence: 1 }
      })
    const holds = new StructuredAgentSessionHolds({
      resume,
      hasProviderChild: () => child,
      isTurnActive: () => false,
      evict: async () => {},
      graceMs: GRACE_MS
    })
    pendingHolds.push(holds)

    await expect(holds.hold('session-1', 'chat-1')).rejects.toThrow('first acquisition failed')
    expect(holds.isResuming('session-1')).toBe(false)
    await holds.hold('session-1', 'chat-1')

    expect(resume).toHaveBeenCalledTimes(2)
    expect(holds.isHeld('session-1')).toBe(true)
  })
})
