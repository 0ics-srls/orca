import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../shared/repo-types'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('child_process', () => ({ spawn: spawnMock, execFileSync: vi.fn() }))
vi.mock('./effective-hook-config', () => ({
  getEffectiveHooksFromConfig: () => ({ scripts: { archive: 'do-the-archive' } })
}))

const REPO: Repo = { id: 'r', path: '/repo', displayName: 'r', badgeColor: '#000', addedAt: 0 }

/** Minimal ChildProcess stand-in: runHook reads the streams and waits for close/error. */
function fakeChild(outcome: { code?: number | null; signal?: NodeJS.Signals | null } | Error) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  const stream = { setEncoding: () => {}, on: () => {} }
  queueMicrotask(() => {
    if (outcome instanceof Error) {
      for (const fn of listeners.error ?? []) {
        fn(outcome)
      }
      return
    }
    for (const fn of listeners.close ?? []) {
      fn(outcome.code ?? null, outcome.signal ?? null)
    }
  })
  return {
    pid: 4242,
    stdout: stream,
    stderr: stream,
    exitCode: null,
    signalCode: null,
    kill: () => true,
    on(event: string, fn: (...args: unknown[]) => void) {
      ;(listeners[event] ??= []).push(fn)
      return this
    }
  }
}

async function runArchiveWith(
  outcome: { code?: number | null; signal?: NodeJS.Signals | null } | Error
): Promise<{ success: boolean; exitCode?: number }> {
  const { runHook } = await import('./hooks')
  spawnMock.mockImplementationOnce(() => fakeChild(outcome))
  const result = await runHook('archive', '/repo/wt', REPO)
  // Guard against a vacuous pass: if the mock stops intercepting, a real shell would run.
  expect(spawnMock).toHaveBeenCalled()
  return result
}

// Why (#19334): an ABSENT exitCode is what the removal gate reads as `unverifiable`. Every row here
// is a way a hook can fail to deliver one. The timeout and termination arms of the same contract
// are covered against REAL processes in hook-termination-real-process.test.ts — deliberately not
// here, because a mocked child cannot show whether a process group exists.
describe('archive hook exit observation', () => {
  it('passes a clean run through without an exit code', async () => {
    await expect(runArchiveWith({ code: 0 })).resolves.toEqual({ success: true, output: '' })
  })

  it.each([
    ['a non-zero exit', 23],
    ['a shell command-not-found', 127]
  ])('reports %s as the observed exit it is', async (_label, code) => {
    await expect(runArchiveWith({ code })).resolves.toMatchObject({
      success: false,
      exitCode: code
    })
  })

  it.each([
    ['was killed by a signal', { code: null, signal: 'SIGKILL' as const }],
    ['never started', new Error('spawn /bin/bash ENOENT')]
  ])('withholds the exit code when the hook %s', async (_label, outcome) => {
    const result = await runArchiveWith(outcome)
    expect(result.success).toBe(false)
    expect(result.exitCode).toBeUndefined()
  })
})
