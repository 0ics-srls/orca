// Which sessions were genuinely working when this process went away.
//
// Read off the LIVE host state, never off a persisted status field. That distinction is the whole
// safety argument: a `running` turn row left behind by an older crash is still sitting in that
// session's journal, and a rule that trusted it would hand a provider child back to work nobody is
// doing. A crashed generation leaves no entry in this map, so it can never produce a marker.
//
// Three facts have to line up for one marker, and each rules out a different false positive:
// this host is running the child (not a journal we merely opened for reading), the journal's newest
// turn is actually running (not one that completed before quit), and the session has a provider
// cursor to resume onto (not a conversation that never proved a thread).

import { agentSessionProviderHandleChainHead } from '../../../shared/agent-session-provider-handle'
import { agentSessionProviderHandleRoot } from '../../../shared/agent-session-provider-handle'
import { projectStructuredAgentSessionStatus } from '../../../shared/structured-agent-session-projection'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type {
  AgentSessionResumeMarker,
  AgentSessionResumeTrigger
} from '../../../shared/agent-session-resume-marker'
import { activeStructuredAgentSessionTurnId } from '../../../shared/structured-agent-session-live-turn'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'

type WorkingCandidateSession = {
  journal: AgentSessionJournal
  /** Only this host generation's own child counts. A restored-for-reading journal has none. */
  hasProviderChild: boolean
}

export function structuredAgentSessionsWorkingAtTeardown(input: {
  sessions: ReadonlyMap<string, WorkingCandidateSession>
  getRecord: (sessionId: string) => AgentSessionRecord | null
  trigger: AgentSessionResumeTrigger
  now: number
}): AgentSessionResumeMarker[] {
  const markers: AgentSessionResumeMarker[] = []
  for (const [sessionId, session] of input.sessions) {
    if (!session.hasProviderChild) {
      continue
    }
    // A journal this host cannot read tells us nothing about what the turn was doing.
    if (session.journal.isReadOnly) {
      continue
    }
    const snapshot = session.journal.snapshot()
    // The product's own classification, so the marker rule cannot disagree with what the UI calls
    // working. A turn blocked on an approval or a question projects as `attention`: the agent is
    // waiting on the USER, and that is not interrupted work to hand back.
    if (projectStructuredAgentSessionStatus(snapshot.items, snapshot.submissions) !== 'working') {
      continue
    }
    const turnId = activeStructuredAgentSessionTurnId(snapshot.items)
    if (!turnId) {
      continue
    }
    const head = agentSessionProviderHandleChainHead(
      input.getRecord(sessionId)?.providerHandleChain ?? []
    )
    if (!head) {
      continue
    }
    markers.push({
      sessionId,
      turnId,
      recordedAt: input.now,
      trigger: input.trigger,
      // Root, not key: the close path advances Claude's leaf moments after this runs, and a key
      // comparison would then refuse the session forever.
      providerHandleRoot: agentSessionProviderHandleRoot(head.handle)
    })
  }
  return markers
}
