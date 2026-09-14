import type { HostedReviewCreationEligibility } from '../../../../shared/hosted-review'
import type { GitUpstreamStatus } from '../../../../shared/git-status-types'
import type { PRState } from '../../../../shared/github/pull-request-types'
import type {
  SourceControlPrimaryActionKind,
  SourceControlRemoteOpKind
} from '../../../../shared/source-control-primary-action-decision-types'

// Why: the primary button collapses to one-label-per-action. Compound kinds
// ('commit_push', 'commit_sync', 'commit_publish') live in DropdownActionKind
// only — never on the primary — so SourceControlPrimaryActionKind excludes
// them, which is what lets `handlePrimaryClick` switch exhaustively and kills
// the compound-commit branch in the isRemoteOperationActive tooltip below at
// compile time.
export type PrimaryAction = {
  kind: SourceControlPrimaryActionKind
  label: string
  title: string
  disabled: boolean
}

export type PrimaryActionInputs = {
  stagedCount: number
  hasUnstagedChanges: boolean
  hasStageableChanges: boolean
  hasPartiallyStagedChanges: boolean
  hasMessage: boolean
  hasUnresolvedConflicts: boolean
  isCommitting: boolean
  isRemoteOperationActive: boolean
  upstreamStatus: GitUpstreamStatus | undefined
  prState?: PRState | null
  isPRStateLoading?: boolean
  // Why: which remote op is currently running, when one is. null when no
  // remote op is in flight. Used by the in-flight branch below to mirror
  // the user-triggered action on the primary button instead of leaving a
  // stale label that no longer matches what the slice is doing.
  inFlightRemoteOpKind?: SourceControlRemoteOpKind | null
  hostedReviewCreation?: HostedReviewCreationEligibility | null
  // Why: branch-compare counts feed Create Review intent eligibility and
  // force-push labels; publishing itself can push the current HEAD even at 0.
  branchCommitsAhead?: number
  // Why: detached HEAD can look like an unpublished branch from upstream
  // status alone, but it has no branch ref that Publish Branch can push.
  hasCurrentBranch?: boolean
  // Why: linked review branches without upstream counts are pushable only when
  // Orca has a persisted or Git-configured target. Otherwise Push could fall
  // through to the default publish-to-origin behavior.
  canPushLinkedReviewWithoutUpstream?: boolean
  isPrIntentInFlight?: boolean
  // Why: eligibility is fetched asynchronously; keep the header anchor visible
  // while the request is in flight instead of flashing it in after ~1s.
  isHostedReviewCreationLoading?: boolean
}
