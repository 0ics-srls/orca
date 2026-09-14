import type { GitStatusEntry } from '../../../src/shared/git-status-types'

export {
  COMMIT_FAILURE_SUMMARY_SCAN_CODE_UNITS,
  buildFixCommitFailurePrompt,
  hasExpandedCommitFailureDetails,
  summarizeCommitFailure
} from '../../../src/shared/source-control-commit-failure'

export type MobileCommitFailureRecovery = {
  error: string
  commitMessage: string
  stagedEntries: Pick<GitStatusEntry, 'path' | 'status' | 'area'>[]
}

export type RecordMobileCommitFailure = (failure: MobileCommitFailureRecovery | null) => void

export function getMobileCommitFailureStagedEntries(
  entries: readonly GitStatusEntry[] | undefined
): Pick<GitStatusEntry, 'path' | 'status' | 'area'>[] {
  return (entries ?? [])
    .filter((entry) => entry.area === 'staged')
    .map((entry) => ({ path: entry.path, status: entry.status, area: entry.area }))
}
