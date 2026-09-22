import type { Store } from '../../../persistence/loading-store/store'
import type { Repo } from '../../../../shared/repo-types'
import { getSshGitProvider } from '../../../providers/ssh-git-dispatch'
import type { DetectedWorktreeListResult } from '../../../../shared/worktree/types'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { projectResolvedWorktreeLineage } from '../../../../shared/resolved-worktree-lineage'
import type { DirectSshDetectedWorktreeRequest } from '../../../../shared/detected-worktree-provider-contract'
import { isAdmissibleDirectSshAuthority } from '../../../../shared/ssh-retained-payload-admission'
import type { ListDesktopLineageForHostArgs } from '../../../../shared/host-lineage-contract'
import {
  buildDetectedGitWorktrees,
  createSshWorktreeMetaIndex,
  listDisconnectedSshWorktrees,
  type SshWorktreeMetaIndex
} from './ssh-worktree-fallback'
import {
  buildDisconnectedDetectedWorktrees,
  buildFolderDetectedWorktrees
} from './folder-workspace-catalog'
import { isFolderWorkspaceIdForRepo } from '../folder-workspace-model'
import { hasConflictingStoredWorktreeOwner } from './worktree-host-ownership'
import {
  applyFreshDetectedWorktreeScanSideEffects,
  listDetectedGitWorktrees,
  type DetectedWorktreeScanResult
} from './detected-worktree-scan-cache'
import {
  getLocalWorktreeScanGeneration,
  isLocalWorktreeScanGenerationCurrent
} from '../../../local-worktree-scan-generation'
import type { SshGitProvider } from '../../../providers/ssh-git-provider'
import {
  describeWorktreeScanFailure,
  loggedWorktreeListFailures,
  warnOnce
} from './worktree-listing-diagnostics'
import { readAllWorktreeMetaForRepo } from '../../../persistence/host-qualified-worktree-meta'
import { classifyWorktreeScanFailure } from '../../../../shared/worktree-scan-failure'

// Why two: one covers the create/delete overlap the scan is re-run for; a second mutation landing
// inside that re-run is the churn case, and a third pass would only chase it.
const SUPERSEDED_SCAN_RESCANS = 2

/**
 * Runs the scan again while a worktree mutation overtook it. A listing speaks for the catalog as of
 * when its scan began, so a scan that a create or delete landed under describes a catalog that no
 * longer exists; published as authoritative, it tells every client that a worktree created during
 * the scan was deleted, and the client retires it. Re-running through the same thunk keeps the
 * guard chain (cache, joiners, side-effect tokens) intact for the second pass.
 *
 * Why null past the bound rather than a non-authoritative answer: non-authoritative rows still
 * replace the client's rows for this host, so a worktree the last overtaking mutation created
 * would vanish from the sidebar until the next listing. Null becomes a stale rejection, which
 * leaves client state untouched; the overtaking mutation's own change event, sent after its
 * generation bump and therefore ahead of this reply, is what brings the listing that reflects it.
 */
async function scanUntilNotOvertaken<T extends { superseded: boolean }>(
  scanOnce: () => Promise<T>,
  mayRescan: () => boolean
): Promise<T | null> {
  let scan = await scanOnce()
  for (let rescans = 0; scan.superseded; rescans += 1) {
    if (rescans >= SUPERSEDED_SCAN_RESCANS || !mayRescan()) {
      return null
    }
    scan = await scanOnce()
  }
  return scan
}

// Why here: an SSH listing bypasses the scan cache, so nothing else witnesses a mutation overtaking
// it. The generation is the one the cache compares, bumped by every worktree change invalidator.
async function listSshWorktreesWithMutationWitness(
  provider: SshGitProvider,
  repo: Repo,
  signal: AbortSignal | undefined
): Promise<DetectedWorktreeScanResult> {
  const generation = getLocalWorktreeScanGeneration(repo.id)
  const gitWorktrees = await provider.listWorktrees(repo.path, { signal })
  return {
    gitWorktrees,
    fresh: true,
    superseded: !isLocalWorktreeScanGenerationCurrent(repo.id, generation)
  }
}

export async function listDetectedWorktreesForCapturedRepo(
  store: Store,
  repo: Repo,
  isCurrent: () => boolean,
  capturedProvider = repo.connectionId ? getSshGitProvider(repo.connectionId) : undefined,
  providerAbort?: { signal: AbortSignal; status: () => 'canceled' | 'timed-out' }
): Promise<DetectedWorktreeListResult | { providerAbortStatus: 'canceled' | 'timed-out' } | null> {
  const abortedResult = () =>
    providerAbort?.signal.aborted
      ? ({ providerAbortStatus: providerAbort.status() } as const)
      : undefined
  const allMeta = isFolderRepo(repo) ? undefined : readAllWorktreeMetaForRepo(store, repo)
  // Why: only the disconnected fallbacks read this, so keep parseWorktreeId over the whole host snapshot
  // off the connected path entirely.
  let cachedSshWorktreeMetaIndex: SshWorktreeMetaIndex | undefined
  const sshWorktreeMetaIndex = (): SshWorktreeMetaIndex =>
    (cachedSshWorktreeMetaIndex ??= createSshWorktreeMetaIndex(Object.entries(allMeta ?? {})))

  try {
    // Why no re-scan for folder repos: their rows come from the store synchronously below, so no
    // mutation can land under the read.
    if (isFolderRepo(repo)) {
      if (!isCurrent()) {
        return null
      }
      const folderWorkspaceIds = Object.keys(store.getAllWorktreeMeta()).filter((worktreeId) =>
        isFolderWorkspaceIdForRepo(repo, worktreeId)
      )
      if (hasConflictingStoredWorktreeOwner(store, repo, folderWorkspaceIds)) {
        return {
          repoId: repo.id,
          authoritative: false,
          source: 'metadata-fallback',
          worktrees: []
        }
      }
      return {
        repoId: repo.id,
        authoritative: true,
        source: 'git',
        worktrees: projectResolvedWorktreeLineage(
          buildFolderDetectedWorktrees(store, repo),
          store.getAllWorktreeLineage?.() ?? {}
        )
      }
    }
    if (repo.connectionId && !capturedProvider) {
      const aborted = abortedResult()
      if (aborted) {
        return aborted
      }
      if (!isCurrent()) {
        return null
      }
      const worktrees = listDisconnectedSshWorktrees(store, repo, sshWorktreeMetaIndex())
      return {
        repoId: repo.id,
        authoritative: false,
        source: 'metadata-fallback',
        worktrees: buildDisconnectedDetectedWorktrees(store, repo, worktrees)
      }
    }
    const scan = await scanUntilNotOvertaken(
      repo.connectionId && capturedProvider
        ? () => listSshWorktreesWithMutationWitness(capturedProvider, repo, providerAbort?.signal)
        : () => listDetectedGitWorktrees(store, repo),
      () => isCurrent() && !providerAbort?.signal.aborted
    )
    if (!scan) {
      return abortedResult() ?? null
    }
    const { gitWorktrees, fresh: freshScan, sideEffectToken, metadataPrune, hygieneDue } = scan
    const aborted = abortedResult()
    if (aborted) {
      return aborted
    }
    if (!isCurrent()) {
      return null
    }
    const listedWorktreeIds = gitWorktrees.map((worktree) => `${repo.id}::${worktree.path}`)
    if (hasConflictingStoredWorktreeOwner(store, repo, listedWorktreeIds)) {
      return {
        repoId: repo.id,
        authoritative: false,
        source: 'metadata-fallback',
        worktrees: []
      }
    }
    if (freshScan) {
      await applyFreshDetectedWorktreeScanSideEffects(store, repo, gitWorktrees, metadataPrune, {
        isCurrent: () => isCurrent() && !providerAbort?.signal.aborted,
        sideEffectToken,
        signal: providerAbort?.signal,
        ...(hygieneDue === undefined ? {} : { hygieneDue })
      })
      const aborted = abortedResult()
      if (aborted) {
        return aborted
      }
      if (!isCurrent()) {
        return null
      }
    }
    loggedWorktreeListFailures.delete(`${repo.id}:${repo.path}`)
    return {
      repoId: repo.id,
      authoritative: true,
      source: 'git',
      worktrees: buildDetectedGitWorktrees(store, repo, gitWorktrees, allMeta)
    }
  } catch (err) {
    const aborted = abortedResult()
    if (aborted) {
      return aborted
    }
    if (!isCurrent()) {
      return null
    }
    warnOnce(
      loggedWorktreeListFailures,
      `${repo.id}:${repo.path}`,
      `[worktrees] failed to list detected worktrees for repo "${repo.displayName}" (${repo.id}) at ${repo.path}`,
      err
    )
    // Why: retention alone leaves inert rows with no explanation; the cause rides with the listing.
    const unavailableReason = describeWorktreeScanFailure(err)
    const failureKind = classifyWorktreeScanFailure(unavailableReason)
    if (repo.connectionId) {
      const worktrees = listDisconnectedSshWorktrees(store, repo, sshWorktreeMetaIndex())
      return {
        repoId: repo.id,
        authoritative: false,
        source: 'metadata-fallback',
        worktrees: buildDisconnectedDetectedWorktrees(store, repo, worktrees),
        unavailableReason,
        failureKind
      }
    }
    return {
      repoId: repo.id,
      authoritative: false,
      source: 'metadata-fallback',
      worktrees: [],
      unavailableReason,
      failureKind
    }
  }
}

export function hasValidDirectSshAuthority(
  args: DirectSshDetectedWorktreeRequest
): args is DirectSshDetectedWorktreeRequest {
  return isAdmissibleDirectSshAuthority(args.expectedAuthority)
}

export function hasValidLineageSshAuthority(
  args: ListDesktopLineageForHostArgs
): args is Extract<ListDesktopLineageForHostArgs, { expectedAuthority: unknown }> {
  if (!('expectedAuthority' in args)) {
    return false
  }
  return isAdmissibleDirectSshAuthority(args.expectedAuthority)
}
