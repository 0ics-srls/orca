import { describe, expect, it, vi } from 'vitest'
import { CodexAppServerRequestError } from './codex-app-server-request-error'
import { changeCodexThreadGoal, codexThreadGoalRequest } from './codex-structured-thread-goal'
import type { CodexSession } from './codex-structured-session-state'

const THREAD = 'thread-1'

function session(request: (...args: unknown[]) => Promise<unknown>) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the goal path reads only these two fields.
  return { threadId: THREAD, connection: { request } } as unknown as Pick<
    CodexSession,
    'connection' | 'threadId'
  >
}

describe('codex thread goal requests', () => {
  it('sets an objective as an active goal with no turn of its own', () => {
    expect(codexThreadGoalRequest(THREAD, { kind: 'set', objective: 'Ship it' })).toEqual({
      method: 'thread/goal/set',
      params: { threadId: THREAD, objective: 'Ship it', status: 'active' }
    })
  })

  it('pauses and resumes by status alone, keeping the objective', () => {
    expect(codexThreadGoalRequest(THREAD, { kind: 'status', status: 'paused' })).toEqual({
      method: 'thread/goal/set',
      params: { threadId: THREAD, status: 'paused' }
    })
    expect(codexThreadGoalRequest(THREAD, { kind: 'status', status: 'active' })).toEqual({
      method: 'thread/goal/set',
      params: { threadId: THREAD, status: 'active' }
    })
  })

  it('clears with only the thread id', () => {
    expect(codexThreadGoalRequest(THREAD, { kind: 'clear' })).toEqual({
      method: 'thread/goal/clear',
      params: { threadId: THREAD }
    })
  })

  it('sends the request with the session deadline', async () => {
    const request = vi.fn(async () => ({ goal: null }))
    await expect(
      changeCodexThreadGoal(session(request), { kind: 'clear' }, 5_000)
    ).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith(
      'thread/goal/clear',
      { threadId: THREAD },
      { timeoutMs: 5_000 }
    )
  })

  it('reports a provider refusal and rethrows anything that leaves the effect unknown', async () => {
    const refused = session(async () => {
      throw new CodexAppServerRequestError('thread/goal/set', -32600, 'goals feature is disabled')
    })
    await expect(
      changeCodexThreadGoal(refused, { kind: 'set', objective: 'Ship it' }, undefined)
    ).resolves.toEqual({ ok: false, rejected: 'goals feature is disabled' })

    const lost = session(async () => {
      throw new Error('codex app-server request timed out')
    })
    await expect(changeCodexThreadGoal(lost, { kind: 'clear' }, undefined)).rejects.toThrow(
      'timed out'
    )
  })
})
