/**
 * Post-mutation status refresh for a per-row stage/unstage/discard.
 *
 * The mutation has already landed by the time this runs, so a refresh rejection is reported as its
 * own failure and never as "Failed to stage/discard …"; the next status poll re-syncs the rows.
 */
export async function refreshEntryMutationStatus(
  refreshActiveGitStatusAfterMutation: () => Promise<void>
): Promise<void> {
  try {
    await refreshActiveGitStatusAfterMutation()
  } catch (error) {
    console.error('[SourceControl] post-entry-mutation git status refresh failed', error)
  }
}
