// The disk witness is only read after Git disagreed about the common dir, so what it answers decides
// whether a worktree Git already wrote is reported as created or abandoned (#16520). A read that
// failed must not be spent as a disagreement.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./worktree-list-reader', () => ({
  readRepoLocation: vi.fn(),
  readRepoCommonDirFromGit: vi.fn(),
  readCheckedOutBranchRef: vi.fn(),
  readWorktreeHeadOid: vi.fn(),
  readTranslatedWorktreeGraph: vi.fn(),
  readWorktreeList: vi.fn()
}))
vi.mock('./worktree-sparse-checkout-cache', () => ({
  detectSparseCheckoutCached: vi.fn(async () => false)
}))

import { describeCreatedWorktree } from './worktree-listing'
import {
  readCheckedOutBranchRef,
  readRepoCommonDirFromGit,
  readRepoLocation,
  readWorktreeHeadOid
} from './worktree-list-reader'

const readRepoLocationMock = vi.mocked(readRepoLocation)
const readRepoCommonDirFromGitMock = vi.mocked(readRepoCommonDirFromGit)
const readCheckedOutBranchRefMock = vi.mocked(readCheckedOutBranchRef)
const readWorktreeHeadOidMock = vi.mocked(readWorktreeHeadOid)

let scratchDir = ''
let repoPath = ''
let worktreePath = ''

/** realpath: the witness canonicalizes, and macOS `tmpdir()` is a symlink (`/var` -> `/private/var`). */
beforeEach(() => {
  scratchDir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-created-witness-')))
  repoPath = join(scratchDir, 'repo')
  worktreePath = join(scratchDir, 'workspaces', 'feature')
  mkdirSync(repoPath, { recursive: true })
  readRepoLocationMock.mockResolvedValue({
    topLevel: worktreePath,
    // Deliberately not the repo's store, so every case below reaches the disk witness.
    commonDir: join(scratchDir, 'elsewhere', '.git')
  })
  // Git's own reading disagrees; only the witness can break the tie.
  readRepoCommonDirFromGitMock.mockResolvedValue(join(scratchDir, 'other-repo', '.git'))
  readCheckedOutBranchRefMock.mockResolvedValue('refs/heads/feature')
  readWorktreeHeadOidMock.mockResolvedValue('a'.repeat(40))
})

afterEach(() => {
  vi.clearAllMocks()
  chmodSync(repoPath, 0o700)
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('describeCreatedWorktree when Git and the repo disagree', () => {
  it('reports nothing when the witness proves a different object store', async () => {
    // A real `.git` file pointing somewhere else: the worktree genuinely is not this repo's.
    writeFileSync(join(repoPath, '.git'), `gitdir: ${join(scratchDir, 'other-repo', '.git')}\n`)
    await expect(
      describeCreatedWorktree(repoPath, worktreePath, 'feature')
    ).resolves.toBeUndefined()
  })

  it('reports nothing for a bare repo, whose missing .git is a real answer', async () => {
    // No `.git` at all -> ENOENT -> `{ status: 'read', commonDir: undefined }`, not unverifiable.
    await expect(
      describeCreatedWorktree(repoPath, worktreePath, 'feature')
    ).resolves.toBeUndefined()
  })

  it('reports nothing when .git is a path under a file, not a directory', async () => {
    // ENOTDIR, the other spelling of absence: `repo` is a file, so `repo/.git` cannot exist.
    const filePath = join(scratchDir, 'plain-file')
    writeFileSync(filePath, 'not a repo\n')
    await expect(
      describeCreatedWorktree(filePath, worktreePath, 'feature')
    ).resolves.toBeUndefined()
  })

  it.runIf(process.platform !== 'win32')(
    'throws rather than claiming a mismatch when the witness cannot be read',
    async () => {
      writeFileSync(join(repoPath, '.git'), 'gitdir: /somewhere\n')
      chmodSync(repoPath, 0o000)
      await expect(describeCreatedWorktree(repoPath, worktreePath, 'feature')).rejects.toThrow(
        /^repo common dir unverifiable: could not read .*\.git: /
      )
    }
  )

  // The other unverifiable branch -- the deadline firing on a `.git` that never answers -- needs a
  // read that really blocks, so it lives in worktree-created-description-real-git.test.ts behind a
  // fifo. A short timeout here would only race the filesystem.

  it('accepts the create when the witness agrees with the worktree', async () => {
    const commonDir = join(repoPath, '.git')
    mkdirSync(commonDir, { recursive: true })
    writeFileSync(join(commonDir, 'HEAD'), 'ref: refs/heads/main\n')
    readRepoLocationMock.mockResolvedValue({ topLevel: worktreePath, commonDir })
    await expect(describeCreatedWorktree(repoPath, worktreePath, 'feature')).resolves.toEqual({
      path: worktreePath,
      head: 'a'.repeat(40),
      branch: 'refs/heads/feature',
      isBare: false,
      isMainWorktree: false
    })
  })
})

describe('describeCreatedWorktree before the witness is reached', () => {
  it('never pays for the disk read when Git already agreed', async () => {
    const commonDir = join(repoPath, '.git')
    mkdirSync(commonDir, { recursive: true })
    readRepoLocationMock.mockResolvedValue({ topLevel: worktreePath, commonDir })
    readRepoCommonDirFromGitMock.mockResolvedValue(commonDir)
    // chmod 000 would make the witness unverifiable; agreement means it is never opened.
    if (process.platform !== 'win32') {
      chmodSync(repoPath, 0o000)
    }
    await expect(describeCreatedWorktree(repoPath, worktreePath, 'feature')).resolves.toMatchObject(
      {
        branch: 'refs/heads/feature'
      }
    )
  })

  it('reports nothing when Git could not confirm the worktree at all', async () => {
    readRepoLocationMock.mockResolvedValue(undefined)
    // An unconfirmed worktree is not an unverifiable common dir: resolving undefined under a repo
    // whose witness cannot be read is how we know the witness was never consulted.
    if (process.platform !== 'win32') {
      chmodSync(repoPath, 0o000)
    }
    await expect(
      describeCreatedWorktree(repoPath, worktreePath, 'feature')
    ).resolves.toBeUndefined()
  })

  it('reports nothing when the worktree has the wrong branch checked out', async () => {
    readCheckedOutBranchRefMock.mockResolvedValue('refs/heads/other')
    if (process.platform !== 'win32') {
      chmodSync(repoPath, 0o000)
    }
    await expect(
      describeCreatedWorktree(repoPath, worktreePath, 'feature')
    ).resolves.toBeUndefined()
  })
})
