import { afterEach, describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock } = vi.hoisted(() => ({ gitExecFileAsyncMock: vi.fn() }))

vi.mock('./runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock,
  gitExecFileSync: vi.fn()
}))

import { clearGitCapabilityStateForTests } from './git-capability-state'
import { searchBaseRefDetails, searchBaseRefDetailsOutcome } from './repo-base-ref-search'

const ROW = 'refs/heads/main\0main'

function respond(handler: (args: string[], cwd: string | undefined) => { stdout: string }): void {
  gitExecFileAsyncMock.mockImplementation(async (args: string[], options?: { cwd?: string }) =>
    handler(args, options?.cwd)
  )
}

describe('searchBaseRefDetailsOutcome', () => {
  afterEach(() => {
    clearGitCapabilityStateForTests()
    gitExecFileAsyncMock.mockReset()
  })

  it('reports an empty result as an answer when git answered', async () => {
    respond(() => ({ stdout: '' }))

    await expect(searchBaseRefDetailsOutcome('/repo', 'feat', 5)).resolves.toEqual({
      status: 'ok',
      results: []
    })
  })

  it('never spells a rejected limit as an answered empty search', async () => {
    respond(() => ({ stdout: ROW }))

    // Both production callers validate before calling, so this is about the type not lying: nothing
    // was asked, and `ok` here would claim the repo has no matching ref.
    const outcome = await searchBaseRefDetailsOutcome('/repo', 'feat', 0)
    expect(outcome.status).toBe('unverifiable')
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('reports a failed for-each-ref as unverifiable rather than as no matching refs', async () => {
    respond((args) => {
      if (args[0] === 'remote') {
        return { stdout: 'origin\n' }
      }
      throw new Error('fatal: not a git repository\nmore detail')
    })

    const outcome = await searchBaseRefDetailsOutcome('/repo', 'feat', 5)
    expect(outcome.status).toBe('unverifiable')
    // First line only: the reason is shown to a person, not parsed.
    expect(outcome).toEqual({
      status: 'unverifiable',
      reason: 'git for-each-ref failed: fatal: not a git repository'
    })
  })

  it('keeps the array adapter empty for callers with no third slot', async () => {
    respond((args) => {
      if (args[0] === 'remote') {
        return { stdout: '' }
      }
      throw new Error('fatal: deadline exceeded')
    })

    await expect(searchBaseRefDetails('/repo', 'feat', 5)).resolves.toEqual([])
  })

  it('does not claim an empty answer when remote names cannot be read', async () => {
    respond((args) => {
      if (args[0] === 'remote') {
        throw new Error('fatal: cannot read config')
      }
      return { stdout: ROW }
    })

    await expect(searchBaseRefDetailsOutcome('/repo', 'feature/x', 5)).resolves.toEqual({
      status: 'unverifiable',
      reason: 'git remote failed: fatal: cannot read config'
    })
    expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('does not pin the failure: concurrent probes both report it and the next call recovers', async () => {
    let failing = true
    respond((args) => {
      if (args[0] === 'remote') {
        return { stdout: '' }
      }
      if (failing) {
        throw new Error('fatal: index.lock exists')
      }
      return { stdout: ROW }
    })

    const [first, second] = await Promise.all([
      searchBaseRefDetailsOutcome('/repo', 'main', 5),
      searchBaseRefDetailsOutcome('/repo', 'main', 5)
    ])
    expect([first.status, second.status]).toEqual(['unverifiable', 'unverifiable'])

    failing = false
    await expect(searchBaseRefDetailsOutcome('/repo', 'main', 5)).resolves.toMatchObject({
      status: 'ok'
    })
  })

  it('scopes the --exclude fallback to the host that executed git', async () => {
    // A WSL UNC cwd is a different execution host from the native binary, per
    // docs/reference/git-compatibility.md, and the capability verdict must not cross between them.
    const wslRepo = '\\\\wsl$\\Ubuntu\\home\\me\\repo'
    const seen: { wsl: boolean; excluded: boolean }[] = []
    respond((args, cwd) => {
      if (args[0] === 'remote') {
        return { stdout: 'origin\n' }
      }
      const excluded = args.some((arg) => arg.startsWith('--exclude=refs/remotes/'))
      const wsl = cwd === wslRepo
      seen.push({ wsl, excluded })
      if (excluded && wsl) {
        throw Object.assign(new Error("unknown option `exclude'"), {
          stderr: "error: unknown option `exclude'"
        })
      }
      return { stdout: ROW }
    })

    await expect(searchBaseRefDetailsOutcome(wslRepo, 'main', 5)).resolves.toMatchObject({
      status: 'ok'
    })
    // The remembered fallback belongs to the distro: a second probe there skips the re-test...
    await expect(searchBaseRefDetailsOutcome(wslRepo, 'main', 5)).resolves.toMatchObject({
      status: 'ok'
    })
    // ...while the native host still gets the preferred command.
    await expect(searchBaseRefDetailsOutcome('/native/repo', 'main', 5)).resolves.toMatchObject({
      status: 'ok'
    })
    expect(seen).toEqual([
      { wsl: true, excluded: true },
      { wsl: true, excluded: false },
      { wsl: true, excluded: false },
      { wsl: false, excluded: true }
    ])
  })
})
