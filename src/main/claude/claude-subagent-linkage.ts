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
  /** A subagent produced them under an identity that is not final yet. The rows
   *  are still written now — with `settledLinkageFor`'s stamp — and this is what
   *  marks them as owing a correction once the announcement lands. */
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
  /** The reference naming the child that journaled a tool call, when a child
   *  did rather than the session's own agent. A grandchild's own
   *  `parent_tool_use_id` is one of those ids, and this is the only route from
   *  it to the agent that actually spawned the grandchild. */
  childOwnerRefOf?: (toolUseId: string) => string | null
}

/** How far a sidechain is followed when naming a row's parent. Depth beyond
 *  this is past anything a transcript shows, and the guard is also what stops a
 *  malformed chain that points at itself from recursing. */
const MAX_PARENT_RESOLUTION_DEPTH = 8

/** A parent's identity, or the fact that it is not final yet. `agentId` absent
 *  with kind `known` is the truthful claim that the session's own agent is the
 *  parent, which is what an unrecorded owner also means. */
type ParentAgentVerdict = { kind: 'known'; agentId?: string } | { kind: 'pending' }

export class ClaudeSubagentLinkage implements ClaudeSubagentLinkageSource {
  constructor(private readonly deps: ClaudeSubagentLinkageDeps) {}

  linkageFor = (parentToolUseId: string): ClaudeSubagentLinkageVerdict =>
    this.resolve(parentToolUseId, false, 0)

  /** The verdict for rows that can wait no longer — the pre-announcement buffer
   *  draining on eviction, at turn settle, or at teardown. Never `pending`:
   *  under settle, a spawn call whose announcement never came resolves to its
   *  own raw id, which is the only handle that child will ever have. */
  settledLinkageFor = (
    parentToolUseId: string
  ): Exclude<ClaudeSubagentLinkageVerdict, { kind: 'pending' }> => {
    const verdict = this.resolve(parentToolUseId, true, 0)
    return verdict.kind === 'pending'
      ? linked(parentToolUseId, parentToolUseId, 'agent', null, undefined)
      : verdict
  }

  private resolve(
    parentToolUseId: string,
    settled: boolean,
    depth: number
  ): ClaudeSubagentLinkageVerdict {
    const canonical = this.deps.ids.canonical(parentToolUseId)
    // An announcement said this task is not a subagent — a backgrounded shell
    // or a workflow. Its output is still not the session's own agent's.
    const excluded = this.deps.ids.isExcluded(parentToolUseId, canonical)
    // An announcement named this spawn call, so the task id behind it is
    // settled — including the case where the two ids are the same string, which
    // comparing them could not tell from never having been announced.
    const announced = this.deps.ids.isAnnounced(parentToolUseId)
    const awaitingOwnAnnouncement =
      !excluded && !announced && this.deps.isForwardedParentTool?.(parentToolUseId) === true
    if (!settled && awaitingOwnAnnouncement) {
      // A top-level spawn call whose `task_started` has not landed yet. Its rows
      // are written immediately under the id it already has and re-attributed
      // when the announcement names it; `pending` is what marks them as owing
      // that correction. Ahead of the release check below because that one
      // reads "no announcement SO FAR", which is also what the session's FIRST
      // child looks like before its own lands.
      return { kind: 'pending' }
    }
    if (!excluded && !announced && !awaitingOwnAnnouncement && !this.deps.announcesTasks()) {
      // Nothing this release runs is ever named, and this reference is not even
      // a spawn call the transcript shows — a nested sidechain id. There is no
      // handle to stamp, so the rows read as the session's own, as they do
      // today. A forwarded spawn call does NOT come here: it reaches this point
      // only when it can wait no longer, and its own id is a real handle, which
      // beats claiming the parent wrote the row.
      return { kind: 'root' }
    }
    // A row names its parent as well as its producer, and it persists only once
    // BOTH are final: a sidechain call's parent is another agent, whose own
    // identity can still be provisional.
    const parent = this.parentAgentFor(parentToolUseId, settled, depth)
    if (parent.kind === 'pending') {
      return { kind: 'pending' }
    }
    if (excluded) {
      return linked(parentToolUseId, canonical, 'background', null, parent.agentId)
    }
    if (announced) {
      return linked(
        parentToolUseId,
        canonical,
        'agent',
        this.deps.trackedFor(canonical),
        parent.agentId
      )
    }
    // Nothing is coming for this id: nested tool traffic, a grandchild inside a
    // sidechain, or a forwarded spawn call that can wait no longer. The raw
    // reference is the only handle there will ever be for it.
    return linked(
      parentToolUseId,
      canonical,
      'agent',
      this.deps.trackedFor(canonical),
      parent.agentId
    )
  }

  /** Who spawned the agent this reference names, resolved through the same path
   *  that reference's own rows resolve through — so a parent id always matches
   *  the `agentId` the parent's own rows carry, however either was settled. */
  private parentAgentFor(
    parentToolUseId: string,
    settled: boolean,
    depth: number
  ): ParentAgentVerdict {
    const ownerRef = this.deps.childOwnerRefOf?.(parentToolUseId) ?? null
    if (ownerRef === null || depth >= MAX_PARENT_RESOLUTION_DEPTH) {
      return { kind: 'known' }
    }
    const owner = this.resolve(ownerRef, settled, depth + 1)
    if (owner.kind === 'pending') {
      return { kind: 'pending' }
    }
    return owner.kind === 'linked' && owner.linkage.agentId !== undefined
      ? { kind: 'known', agentId: owner.linkage.agentId }
      : { kind: 'known' }
  }
}

function linked(
  parentToolUseId: string,
  agentId: string,
  producerKind: NonNullable<AgentJournalProducerLinkage['producerKind']>,
  tracked: ClaudeSubagentLinkageEntry | null,
  parentAgentId: string | undefined
): Extract<ClaudeSubagentLinkageVerdict, { kind: 'linked' }> {
  return {
    kind: 'linked',
    linkage: {
      agentId,
      // Absent means the session's own agent spawned this one, so it is only
      // ever written when ANOTHER agent is known to have. A malformed chain
      // that loops back names the agent its own ancestor; the depth guard
      // bounds that walk but cannot make its answer mean anything, and absence
      // is the truthful claim rather than a self-parent persisted for ever.
      ...(parentAgentId === undefined || parentAgentId === agentId ? {} : { parentAgentId }),
      providerParentRef: parentToolUseId,
      producerKind,
      // The first run is the absence of an attempt, like every other field
      // here: absence is the claim, so only a reopened run states one.
      ...(tracked && tracked.attempt > 1 ? { attempt: tracked.attempt } : {})
    }
  }
}
