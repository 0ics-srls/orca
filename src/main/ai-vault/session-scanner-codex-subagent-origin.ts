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
 * Why a Codex rollout is not the user's own thread, and who spawned it. Codex's
 * protocol keeps those apart and so does this: `kind` is the union tag naming
 * the sort of non-user thread — a spawned agent, but equally a review pass, a
 * compaction, a memory consolidation — while `parentage` is the thread it came
 * from. Only the spawn tag carries a spawn record, so a null `parentage` says
 * nothing about the spawn was readable, never that the thread is rooted.
 */
export type CodexSubagentOrigin = {
  /**
   * The `source.subagent` union tag, verbatim snake_case: 'thread_spawn',
   * 'review', 'compact', 'memory_consolidation', 'other', or a tag a later
   * release adds. Null when `thread_source` alone stated the thread is not the
   * user's and `source` stated nothing structural.
   */
  kind: string | null
  /** Free text the tag carries — the 'other' tag's label; null for tags without one. */
  kindLabel: string | null
  /** Verbatim non-user `thread_source`; null on payloads that state none. */
  threadSource: string | null
  parentage: CodexSubagentParentage | null
}

/**
 * Read a `session_meta` payload's subagent origin, or null for a user thread.
 *
 * The payload states this in two places that disagree in coverage. `source` is
 * the structural field Codex's own runtime switches on; `thread_source` is an
 * analytics label that some releases omit entirely. A payload stating only one
 * of them is normal, so each field is read independently and a tag that carries
 * no spawn record still classifies the thread.
 */
export function readCodexSubagentOrigin(
  payload: Record<string, unknown>
): CodexSubagentOrigin | null {
  const threadSource = extractString(payload.thread_source) ?? extractString(payload.threadSource)
  const tag = readCodexSubagentSourceTag(asRecord(payload.source)?.subagent)
  if (threadSource) {
    // A stated thread_source is the provider's own verdict, so it outranks
    // `source` even when the two disagree.
    if (threadSource.toLowerCase() === 'user') {
      return null
    }
  } else if (!tag) {
    return null
  }
  return {
    kind: tag?.kind ?? null,
    kindLabel: extractString(tag?.content),
    threadSource,
    parentage: readCodexSubagentParentage(payload, asRecord(tag?.content))
  }
}

type CodexSubagentSourceTag = {
  kind: string
  /** The tag's payload: free text for 'other', the record for 'thread_spawn'. */
  content: unknown
}

/**
 * Read `source.subagent` as the externally tagged union it is: a payload-less
 * tag is a bare string ('review'), a tag with one is a single-key object
 * (`{ thread_spawn: { ... } }`, `{ other: 'label' }`). Anything else states no
 * tag at all — and treating an unreadable value as a spawn would drop the
 * user's own thread out of their history, where letting an unrecognised one
 * through only shows a transcript they can see and ignore.
 */
function readCodexSubagentSourceTag(value: unknown): CodexSubagentSourceTag | null {
  const bareTag = extractString(value)
  if (bareTag) {
    return { kind: bareTag, content: undefined }
  }
  const record = asRecord(value)
  const keys = record ? Object.keys(record) : []
  const kind = keys.length === 1 ? extractString(keys[0]) : null
  return kind && record ? { kind, content: record[kind] } : null
}

// The spawn record's fields are copied onto the payload's own keys, so each one
// falls back rather than being discarded with its record. `depth` has no copy to
// fall back to; `agent_role` is documented with `agent_type` as its alias, in
// both places.
function readCodexSubagentParentage(
  payload: Record<string, unknown>,
  spawn: Record<string, unknown> | null
): CodexSubagentParentage | null {
  const parentage: CodexSubagentParentage = {
    parentThreadId:
      extractString(spawn?.parent_thread_id) ?? extractString(payload.parent_thread_id),
    depth: codexSpawnDepth(spawn?.depth),
    agentNickname: extractString(spawn?.agent_nickname) ?? extractString(payload.agent_nickname),
    agentRole:
      extractString(spawn?.agent_role) ??
      extractString(spawn?.agent_type) ??
      extractString(payload.agent_role) ??
      extractString(payload.agent_type),
    agentPath: extractString(spawn?.agent_path) ?? extractString(payload.agent_path)
  }
  return Object.values(parentage).some((field) => field !== null) ? parentage : null
}

// Codex numbers a direct child 1, so a fractional or non-positive depth is
// contradictory data: unknown beats recording it.
function codexSpawnDepth(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}
