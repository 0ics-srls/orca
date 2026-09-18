// The launch-scoped life of the durable recovery claim.
//
// The take IS the deletion — the capsule is emptied in the same step it is read — so everything
// after it lives here in memory, and whatever the offer still owes when Orca exits is written back.
// That makes the claim a durable obligation, and a durable obligation needs a way to die:
// reconnecting SPENDS it, an explicit dismiss ABANDONS it, and reopening the chat RECOVERS it — a
// resume-capable hold hands the provider back at the same proved cursor, which is the whole of what
// the offer would have done. The marker TTL is the backstop behind all three, not the exit.
//
// Recovery ends the OFFER, not the EVIDENCE. The markers say what the last teardown interrupted,
// and that stays true after the chat is reopened: a user looking at a recovered chat can still ask
// the agent to carry on, and the predicate — never this set — is what authorizes that. What
// recovery ends is the advertising, and with it the write-back that would otherwise re-offer a chat
// the user has already got back at every launch from here on.

import type { AgentSessionResumeMarker } from '../../../shared/agent-session-resume-marker'

export type StructuredAgentSessionRestartClaim = {
  /** Every claimed marker, with each session this launch has not opened revealed first so its own
   *  journal can answer for it. An unreadable journal leaves the predicate with one record instead
   *  of two, which refuses. */
  evidence: () => Promise<AgentSessionResumeMarker[]>
  /** What the host still advertises, and what teardown writes back: evidence minus recovery. */
  offered: () => AgentSessionResumeMarker[]
  /** Acted on. In memory, because the durable copy is already gone. */
  spend: (sessionId: string) => boolean
  /** This launch handed the provider back; see the header. */
  recover: (sessionId: string) => void
  /** Turned down outright, answering how many markers that abandoned. */
  abandon: () => Promise<number>
}

export function createStructuredAgentSessionRestartClaim(deps: {
  /** Atomic take of the durable capsule. Absent when the host runs without one. */
  take: () => Promise<AgentSessionResumeMarker[]> | undefined
  isOpen: (sessionId: string) => boolean
  open: (sessionId: string) => Promise<unknown>
}): StructuredAgentSessionRestartClaim {
  let claimed: AgentSessionResumeMarker[] | null = null
  let claiming: Promise<void> | undefined
  const recovered = new Set<string>()

  const claim = async (): Promise<AgentSessionResumeMarker[]> => {
    claiming ??= (async () => {
      try {
        claimed = (await deps.take()) ?? []
      } catch {
        console.warn('[structured-agent-session] taking recovery capsule failed')
        claimed = []
      }
    })()
    await claiming
    return claimed ?? []
  }

  const offered = (): AgentSessionResumeMarker[] =>
    (claimed ?? []).filter((marker) => !recovered.has(marker.sessionId))

  return {
    evidence: async () => {
      for (const marker of await claim()) {
        if (!deps.isOpen(marker.sessionId)) {
          await deps.open(marker.sessionId).catch(() => null)
        }
      }
      return claimed ?? []
    },
    offered,
    spend: (sessionId) => {
      const before = claimed?.length ?? 0
      claimed = (claimed ?? []).filter((marker) => marker.sessionId !== sessionId)
      return claimed.length < before
    },
    recover: (sessionId) => {
      // Kept only for sessions a claim could name — including while the take is still in flight,
      // which is the one window where the answer is not knowable yet.
      if (claimed === null || claimed.some((marker) => marker.sessionId === sessionId)) {
        recovered.add(sessionId)
      }
    },
    abandon: async () => {
      await claim()
      const spent = offered().length
      claimed = []
      return spent
    }
  }
}
