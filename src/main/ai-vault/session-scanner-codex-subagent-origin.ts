import { asRecord, extractString } from './session-scanner-values'

/**
 * What Codex stated about the spawn that produced a thread. `parentThreadId` is
 * the only join key here: `agentPath` is a slash-rooted naming path
 * (`/root/pr_review_pass_1`) that labels agents rather than identifying them.
 */
export type CodexSubagentParentage = {
  parentThreadId: string | null
  /** 1 for a direct child of a user thread; real rollouts nest to 3. */
  depth: number | null
  agentNickname: string | null
  agentRole: string | null
  agentPath: string | null
}

/**
 * Why a Codex rollout is not the user's own thread, plus whatever parentage the
 * writing release stated. A null `parentage` means nothing about the spawn was
 * readable — never that the thread is rooted.
 */
export type CodexSubagentOrigin = {
  /** Verbatim non-user `thread_source`; null on releases that state none. */
  threadSource: string | null
  parentage: CodexSubagentParentage | null
}

/**
 * Read a `session_meta` payload's subagent origin, or null for a user thread.
 *
 * Releases disagree about where they state this. Newer ones nest the full record
 * under `source.subagent.thread_spawn` and copy the parent, nickname and path
 * onto the payload's own keys; 0.144-0.147 state only the agent's role there
 * (`source: { subagent: 'review' }`) and leave the payload copies as the sole
 * statement of the parent. Each field is read independently so a release that
 * states three of them is not discarded for omitting the other two.
 */
export function readCodexSubagentOrigin(
  payload: Record<string, unknown>
): CodexSubagentOrigin | null {
  const threadSource = extractString(payload.thread_source) ?? extractString(payload.threadSource)
  const subagentSource = asRecord(payload.source)?.subagent
  if (threadSource) {
    // A stated thread_source is the provider's own verdict, so it outranks
    // `source` even when the two disagree.
    return threadSource.toLowerCase() === 'user'
      ? null
      : { threadSource, parentage: readCodexSubagentParentage(payload, subagentSource) }
  }
  if (subagentSource === undefined || subagentSource === null) {
    return null
  }
  return { threadSource: null, parentage: readCodexSubagentParentage(payload, subagentSource) }
}

function readCodexSubagentParentage(
  payload: Record<string, unknown>,
  subagentSource: unknown
): CodexSubagentParentage | null {
  const spawn = asRecord(asRecord(subagentSource)?.thread_spawn)
  const parentage: CodexSubagentParentage = {
    parentThreadId:
      extractString(spawn?.parent_thread_id) ?? extractString(payload.parent_thread_id),
    depth: codexSpawnDepth(spawn?.depth),
    agentNickname: extractString(spawn?.agent_nickname) ?? extractString(payload.agent_nickname),
    // A release that states no spawn record names the agent's role in `subagent`.
    agentRole: extractString(spawn?.agent_role) ?? extractString(subagentSource),
    agentPath: extractString(spawn?.agent_path) ?? extractString(payload.agent_path)
  }
  return Object.values(parentage).some((field) => field !== null) ? parentage : null
}

// Codex numbers a direct child 1, so a fractional or non-positive depth is
// contradictory data: unknown beats recording it.
function codexSpawnDepth(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}
