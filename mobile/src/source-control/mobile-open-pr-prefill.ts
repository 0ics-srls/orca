import type { GitStatusResult } from '../../../src/shared/git-status-types'
import { readMobileGitStatusResult } from '../session/mobile-diff-review-rpc'

// Refresh after a push when possible so readiness reflects the new upstream state.
export async function readFreshGitStatus(
  worktreeId: string,
  fallback: GitStatusResult | null,
  sendGitRequest: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
): Promise<GitStatusResult | null> {
  try {
    const fresh = await sendGitRequest<unknown>('git.status', { worktree: `id:${worktreeId}` })
    return readMobileGitStatusResult(fresh) ?? fallback
  } catch {
    return fallback
  }
}

export function getMobilePrEligibilityReadiness(status: GitStatusResult | null): {
  hasUncommittedChanges?: boolean
  hasUpstream?: boolean
  ahead?: number
  behind?: number
} {
  if (!status) {
    return {}
  }
  const up = status?.upstreamStatus
  const upstreamReadiness = up
    ? {
        hasUpstream: up.hasUpstream,
        ahead: up.ahead,
        behind: up.behind
      }
    : {}
  return {
    hasUncommittedChanges: (status.entries?.length ?? 0) > 0,
    ...upstreamReadiness
  }
}
