import type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'
import type { ClaudeStructuredSessionAdapterDeps } from './claude-structured-session-state'
import { readClaudeTranscriptLeafWithReproof } from './claude-transcript-branch-proof'

/**
 * Where a plain resume continues. The stored cursor is only a hint: an owner that died before its
 * close path ran leaves it behind the conversation, and resuming there branches off an old point.
 * The transcript on this host is the truth, so the cursor is re-derived from it here; anything the
 * transcript cannot vouch for resumes by session id alone, which is the provider's latest state.
 */
export async function rederiveClaudeResumePoint(
  launch: ClaudeStructuredLaunch,
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'readTranscriptLeaf'>
): Promise<void> {
  if (!launch.resumed) {
    return
  }
  let derived: string | null = null
  if (deps.readTranscriptLeaf) {
    try {
      derived = await readClaudeTranscriptLeafWithReproof({
        readTranscriptLeaf: deps.readTranscriptLeaf,
        providerSessionId: launch.providerSessionId,
        previousLeafUuid: launch.resumeLeafUuid,
        claudeConfigDir: launch.claudeConfigDir
      })
    } catch {
      derived = null
    }
  }
  const options = { ...launch.options }
  delete options.resumeSessionAt
  launch.options = derived === null ? options : { ...options, resumeSessionAt: derived }
  launch.resumeLeafUuid = derived
}
