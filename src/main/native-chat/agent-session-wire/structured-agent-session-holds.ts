// The lifetime of a structured session, tied to the surfaces that want one.
//
// Nothing used to tell the host that a chat WANTED a session, and nothing told it when a chat
// stopped wanting one. Both halves of that gap cost real processes: sessions nobody had opened got
// an app-server at every launch, and sessions the user closed kept theirs until the app quit.
//
// A surface takes a hold when it binds and drops it when it goes away. The first hold on a session
// with no child resumes it — that, and not the shape of a lease on disk, is what makes a provider
// process exist. The last hold leaving starts the idle release clock. Transport close is the BACKSTOP,
// not the mechanism: a client that vanishes mid-flight never sends its release, so the caller
// registers one against the connection and the holder set absorbs the duplicate.
//
// A send to a childless session resumes it too, through the same single-flight: whoever asks first
// starts the one resume, and everyone who asks while it runs shares its outcome. Two resumes for
// one session would each attach against the same released fence, and the loser's stale fence
// refuses it — a hold that lost dropped its holder, a send that lost was refused.

import {
  StructuredAgentSessionReleaseClock,
  type StructuredAgentSessionReleaseClockDeps
} from './structured-agent-session-release-clock'
import { StructuredAgentSessionHolders } from './structured-agent-session-holders'

/** A resume moves the fence; a writer that was current as of the lost owner rebases from here. */
export type StructuredAgentSessionResumed = { fromFence: number }

export type StructuredAgentSessionHoldsDeps = {
  /** Acquires a provider child for a session that has none. Throws the refusal code when it cannot. */
  resume: (sessionId: string) => Promise<StructuredAgentSessionResumed>
  /** Whether evicting this session would actually free anything. */
  hasProviderChild: (sessionId: string) => boolean
  isTurnActive: (sessionId: string) => boolean
  evict: (sessionId: string) => Promise<void>
  onError?: (input: { sessionId: string; error: unknown }) => void
  graceMs?: number
}

export type StructuredAgentSessionHoldOptions = {
  /** False for a hold that only RETAINS — a subscription stream, which must not make a child
   *  exist just by reading history. */
  resume?: boolean
}

export class StructuredAgentSessionHolds {
  private readonly holders = new StructuredAgentSessionHolders()
  private readonly clock: StructuredAgentSessionReleaseClock
  private readonly resumes = new Map<string, Promise<StructuredAgentSessionResumed>>()
  private disposed = false

  constructor(private readonly deps: StructuredAgentSessionHoldsDeps) {
    const clockDeps: StructuredAgentSessionReleaseClockDeps = {
      isTurnActive: deps.isTurnActive,
      isHeld: (sessionId) => this.holders.isHeld(sessionId),
      evict: (sessionId) => this.deps.evict(sessionId),
      ...(deps.onError ? { onError: deps.onError } : {}),
      ...(deps.graceMs === undefined ? {} : { graceMs: deps.graceMs })
    }
    this.clock = new StructuredAgentSessionReleaseClock(clockDeps)
  }

  async hold(
    sessionId: string,
    holderId: string,
    options: StructuredAgentSessionHoldOptions = {}
  ): Promise<void> {
    const alreadyHeld = this.holders.has(sessionId, holderId)
    this.holders.add(sessionId, holderId, options.resume !== false)
    const incarnation = this.holders.incarnation(sessionId, holderId)
    // Unconditional, not only on the first-holder edge: a second surface arriving during the grace
    // window must cancel the pending release too.
    this.clock.cancel(sessionId)
    if (options.resume === false) {
      return
    }
    if (!this.deps.hasProviderChild(sessionId)) {
      try {
        await this.resumeUnheld(sessionId)
      } catch (error) {
        if (!alreadyHeld && incarnation !== undefined) {
          this.release(sessionId, holderId, incarnation)
        }
        throw error
      }
    }
  }

  /** Resumes a childless session, or joins the resume already running for it. With no surface
   *  holding it afterwards, the child is released on the same clock a departed surface would start. */
  resumeUnheld(sessionId: string): Promise<StructuredAgentSessionResumed> {
    const inFlight = this.resumes.get(sessionId)
    if (inFlight) {
      return inFlight
    }
    const resume = this.resumeOnce(sessionId).finally(() => this.resumes.delete(sessionId))
    this.resumes.set(sessionId, resume)
    return resume
  }

  isResuming(sessionId: string): boolean {
    return this.resumes.has(sessionId)
  }

  private async resumeOnce(sessionId: string): Promise<StructuredAgentSessionResumed> {
    const resumed = await this.deps.resume(sessionId)
    if (!this.deps.hasProviderChild(sessionId)) {
      throw new Error('agent_session_ownership_unknown')
    }
    // The last surface can disconnect before acquisition makes a child available to release.
    if (!this.disposed && !this.holders.isHeld(sessionId)) {
      this.clock.arm(sessionId)
    }
    return resumed
  }

  /** Journal activity; only an unheld session's pending release notices. */
  renew(sessionId: string): void {
    this.clock.renew(sessionId)
  }

  release(sessionId: string, holderId: string, expectedIncarnation?: symbol): void {
    if (!this.holders.remove(sessionId, holderId, expectedIncarnation)) {
      return
    }
    if (!this.disposed && this.deps.hasProviderChild(sessionId)) {
      this.clock.arm(sessionId)
    }
  }

  /** Drops the holders of a session that is gone, whoever evicted it. */
  forget(sessionId: string): void {
    this.clock.cancel(sessionId)
    this.holders.forget(sessionId)
  }

  isHeld(sessionId: string): boolean {
    return this.holders.isHeld(sessionId)
  }

  hasResumeCapableHolder(sessionId: string): boolean {
    return this.holders.hasResumeCapableHolder(sessionId)
  }

  isReleasePending(sessionId: string): boolean {
    return this.clock.isArmed(sessionId)
  }

  dispose(): void {
    this.disposed = true
    this.clock.dispose()
  }
}
