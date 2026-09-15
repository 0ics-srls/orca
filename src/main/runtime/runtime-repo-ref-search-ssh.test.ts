import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'

const { execMock, localGitMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  localGitMock: vi.fn()
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: vi.fn(() => ({ exec: execMock }))
}))
vi.mock('../git/runner', () => ({ gitExecFileAsync: localGitMock, gitExecFileSync: vi.fn() }))

import { clearGitCapabilityStateForTests } from '../git/git-capability-state'
import { RuntimeRepositoryRefQueries } from './runtime-repository-ref-queries'

const repo: Repo = {
  id: 'remote-repo',
  path: '/remote/repo',
  connectionId: 'ssh-1',
  displayName: 'Remote',
  badgeColor: '',
  addedAt: 0
}

const queries = new RuntimeRepositoryRefQueries({ resolveRepo: async () => repo })

describe('SSH repo.searchRefs', () => {
  afterEach(() => {
    execMock.mockReset()
    localGitMock.mockReset()
    clearGitCapabilityStateForTests()
  })

  it('does not run local Git when the SSH ref command fails', async () => {
    execMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') {
        return { stdout: 'origin\n' }
      }
      throw new Error('remote disconnected')
    })

    await expect(queries.search(repo.id, 'main', 10)).resolves.toMatchObject({
      refs: [],
      unverifiableReason: 'git for-each-ref failed: remote disconnected'
    })
    expect(localGitMock).not.toHaveBeenCalled()
  })

  it('does not turn a failed SSH remote-name lookup into no matches', async () => {
    execMock.mockRejectedValue(new Error('remote config unavailable'))

    await expect(queries.search(repo.id, 'feature/x', 10)).resolves.toMatchObject({
      refs: [],
      unverifiableReason: 'git remote failed: remote config unavailable'
    })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(localGitMock).not.toHaveBeenCalled()
  })
})
