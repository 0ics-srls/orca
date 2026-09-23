import type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'
import type {
  ClaudeSession,
  ClaudeStructuredSessionAdapterDeps
} from './claude-structured-session-state'
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

/**
 * Advance the durable resume point to the live leaf once a turn ends, so an owner that dies before
 * its close path runs still resumes from its last completed turn. Writes run one at a time, and a
 * failure is only logged: this is bookkeeping and must never fail the turn.
 */
export function persistClaudeTurnResumePoint(
  sessionId: string,
  session: ClaudeSession,
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'persistResumePoint'>
): void {
  const leafUuid = session.leafUuid
  const persist = deps.persistResumePoint
  if (
    !persist ||
    leafUuid === null ||
    session.closeFinalization ||
    session.closeFinalized ||
    session.resumePointWrite?.leafUuid === leafUuid
  ) {
    return
  }
  const previous = session.resumePointWrite?.settled ?? Promise.resolve()
  session.resumePointWrite = {
    leafUuid,
    settled: previous
      .then(() =>
        persist({
          sessionId,
          providerSessionId: session.providerSessionId,
          leafUuid,
          fence: session.fence
        })
      )
      .catch((error: unknown) => {
        console.warn('[claude-resume-point] turn-end resume point was not persisted:', {
          sessionId,
          leafUuid,
          error
        })
      })
  }
}
