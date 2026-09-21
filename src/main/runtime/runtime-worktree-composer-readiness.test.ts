import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  waitForWorktreeStartupDraft,
  waitForWorktreeStartupFollowup,
  type WorktreeStartupReadinessHost
} from './runtime-worktree-startup-readiness'

describe('host composer admission for worktree startup', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function host(): WorktreeStartupReadinessHost {
    return {
      getPtyId: () => 'pty',
      getForegroundProcess: vi.fn().mockResolvedValue('claude'),
      subscribeToData: vi.fn(),
      readRecentOutput: () => '\x1b[?2004h',
      readComposerReady: vi.fn().mockResolvedValue(false),
      write: vi.fn()
    }
  }

  it.each(['draft', 'followup'])(
    'holds %s despite paste mode and a matching process',
    async (kind) => {
      const target = host()
      const waiting =
        kind === 'draft'
          ? waitForWorktreeStartupDraft(target, 'handle', 'claude')
          : waitForWorktreeStartupFollowup(target, 'handle', 'claude')
      let settled = false
      void waiting.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(8000)
      expect(settled).toBe(false)
      target.readComposerReady = vi.fn().mockResolvedValue(true)
      await vi.advanceTimersByTimeAsync(250)
      await expect(waiting).resolves.toBe('pty')
      expect(target.subscribeToData).not.toHaveBeenCalled()
    }
  )

  it('does not follow a replaced PTY', async () => {
    const target = host()
    const waiting = waitForWorktreeStartupDraft(target, 'handle', 'claude')
    await vi.advanceTimersByTimeAsync(1000)
    target.getPtyId = () => 'replacement'
    target.readComposerReady = vi.fn().mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(250)
    await expect(waiting).resolves.toBeNull()
  })

  it('times out without spending process presence on a paste', async () => {
    const target = host()
    const waiting = waitForWorktreeStartupDraft(target, 'handle', 'claude')
    await vi.advanceTimersByTimeAsync(60000)
    await expect(waiting).resolves.toBeNull()
    expect(target.getForegroundProcess).not.toHaveBeenCalled()
  })
})
