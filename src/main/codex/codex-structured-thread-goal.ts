import type { AgentSessionThreadGoalChange } from '../../shared/agent-session-wire'
import { isCodexAppServerRequestError } from './codex-app-server-connection'
import type { CodexSession } from './codex-structured-session-state'

/** The app-server request that makes one goal change on a thread. */
export function codexThreadGoalRequest(
  threadId: string,
  change: AgentSessionThreadGoalChange
): { method: 'thread/goal/set' | 'thread/goal/clear'; params: Record<string, unknown> } {
  if (change.kind === 'clear') {
    return { method: 'thread/goal/clear', params: { threadId } }
  }
  // An active goal on an idle thread starts work by itself, so a set needs no turn.
  return {
    method: 'thread/goal/set',
    params:
      change.kind === 'set'
        ? { threadId, objective: change.objective, status: 'active' }
        : { threadId, status: change.status }
  }
}

export async function changeCodexThreadGoal(
  session: Pick<CodexSession, 'connection' | 'threadId'>,
  change: AgentSessionThreadGoalChange,
  timeoutMs: number | undefined
): Promise<{ ok: true } | { ok: false; rejected: string }> {
  const request = codexThreadGoalRequest(session.threadId, change)
  try {
    await session.connection.request(request.method, request.params, { timeoutMs })
    return { ok: true }
  } catch (error) {
    if (isCodexAppServerRequestError(error)) {
      return { ok: false, rejected: error.message }
    }
    throw error
  }
}
