// Who produced a Claude journal row, decided from the roster's own knowledge.
//
// Separate from the roster because it answers a different question. The roster
// maintains the spawn-group row a user reads; this answers, for one frame's
// `parent_tool_use_id`, whether the rows that frame produces are the session's
// own agent's, some child's, or nobody's yet.
//
// The identity it hands out is always the CANONICAL task id, never the tool id
// the frame arrived under. Claude re-announces a resumed task under a new tool
// id while its task id stays put, so a durable row stamped with the tool id
// splits one child into two the moment it resumes — and the journal is the
// durable record, with no backfill to repair it afterwards.

import type { AgentJournalProducerLinkage } from '../../shared/agent-session-journal-types'
import type { ClaudeSubagentIds } from './claude-subagent-id-aliases'

/** What a frame's `parent_tool_use_id` says about the rows it produces. */
export type ClaudeSubagentLinkageVerdict =
  /** A subagent produced them, under an identity that will not change. */
  | { kind: 'linked'; linkage: AgentJournalProducerLinkage }
  /** A subagent produced them, but its identity is still provisional, so the
   *  rows wait for the announcement rather than persisting a rotating id. */
  | { kind: 'pending' }
  /** Read them as the session's own. Only for a CLI release that announces no
   *  tasks at all, where nothing stable is ever reachable for these children. */
  | { kind: 'root' }

/** This resolver, as a write site asking who produced a row sees it. */
export type ClaudeSubagentLinkageSource = {
  linkageFor: (parentToolUseId: string) => ClaudeSubagentLinkageVerdict
  settledLinkageFor: (
    parentToolUseId: string
  ) => Exclude<ClaudeSubagentLinkageVerdict, { kind: 'pending' }>
}

/** What the roster knows about one child, reduced to what attribution needs. */
export type ClaudeSubagentLinkageEntry = { attempt: number }

export type ClaudeSubagentLinkageDeps = {
  ids: ClaudeSubagentIds
  /** Whether this CLI release has ever announced a task. */
  announcesTasks: () => boolean
  trackedFor: (canonicalId: string) => ClaudeSubagentLinkageEntry | null
  /** Whether a tool id was forwarded at the TOP level. A child parented to one
   *  was spawned by a call the transcript shows, so its announcement is still
   *  expected; a child parented to anything else names an id that only ever
   *  existed inside a sidechain, which this CLI will never announce. */
  isForwardedParentTool?: (toolUseId: string) => boolean
}

export class ClaudeSubagentLinkage implements ClaudeSubagentLinkageSource {
  constructor(private readonly deps: ClaudeSubagentLinkageDeps) {}

  linkageFor = (parentToolUseId: string): ClaudeSubagentLinkageVerdict => {
    const canonical = this.deps.ids.canonical(parentToolUseId)
    if (this.deps.ids.isExcluded(parentToolUseId, canonical)) {
      // An announcement said this task is not a subagent — a backgrounded shell
      // or a workflow. Its output is still not the session's own agent's.
      return linked(parentToolUseId, canonical, 'background', null)
    }
    if (this.deps.ids.isAnnounced(parentToolUseId)) {
      // An announcement named this spawn call, so the task id behind it is
      // settled — including the case where the two ids are the same string,
      // which comparing them could not tell from never having been announced.
      return linked(parentToolUseId, canonical, 'agent', this.deps.trackedFor(canonical))
    }
    if (!this.deps.announcesTasks()) {
      // This release has announced no task at all, so nothing stable is ever
      // reachable for any child it runs. An id that rotates is worse than no id
      // — silently wrong rather than visibly absent — so these rows read as the
      // session's own, exactly as they do today.
      return { kind: 'root' }
    }
    if (this.deps.isForwardedParentTool?.(parentToolUseId) === true) {
      // A top-level spawn call whose `task_started` has not landed yet. Its
      // rows wait: the spawn call's id is re-minted by a resume, and there is
      // no backfill to repair a row written under it.
      return { kind: 'pending' }
    }
    // This CLI announces what it spawns and never named this id, so nothing is
    // coming: nested tool traffic, or a grandchild inside a sidechain. The raw
    // reference is the only handle there will ever be for it.
    return linked(parentToolUseId, canonical, 'agent', this.deps.trackedFor(canonical))
  }

  /** The verdict for rows that can wait no longer — the pre-announcement buffer
   *  draining on eviction, at turn settle, or at teardown. Never `pending`. */
  settledLinkageFor = (
    parentToolUseId: string
  ): Exclude<ClaudeSubagentLinkageVerdict, { kind: 'pending' }> => {
    const verdict = this.linkageFor(parentToolUseId)
    if (verdict.kind !== 'pending') {
      return verdict
    }
    // The announcement never came. The spawn call's own id is the only handle
    // this child will ever have, and a row written under it is still honestly a
    // child's — which a row written as the parent's would not be.
    return linked(parentToolUseId, parentToolUseId, 'agent', null)
  }
}

function linked(
  parentToolUseId: string,
  agentId: string,
  producerKind: NonNullable<AgentJournalProducerLinkage['producerKind']>,
  tracked: ClaudeSubagentLinkageEntry | null
): Extract<ClaudeSubagentLinkageVerdict, { kind: 'linked' }> {
  return {
    kind: 'linked',
    linkage: {
      agentId,
      providerParentRef: parentToolUseId,
      producerKind,
      // The first run is the absence of an attempt, like every other field
      // here: absence is the claim, so only a reopened run states one.
      ...(tracked && tracked.attempt > 1 ? { attempt: tracked.attempt } : {})
    }
  }
}
