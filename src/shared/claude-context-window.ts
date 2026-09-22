// Claude's context window for a session, only where the host can establish it.
// The CLI runs any `[1m]` model id with the 1M window; for any other id the
// window depends on account, provider and environment, which the host cannot see.

export const CLAUDE_LONG_CONTEXT_WINDOW_TOKENS = 1_000_000

const LONG_CONTEXT_SUFFIX = /\[1m\]$/i

/**
 * @param resolvedSessionModel the host CLI's resolved id for the session's model
 *   (e.g. `claude-opus-5-5[1m]`), from its own model listing.
 * @param transcriptModel the model the transcript last answered with; it records
 *   the id without the suffix (`claude-opus-5-5`).
 * @returns the window in tokens, or null when it cannot be established.
 */
export function claudeContextWindowTokens(
  resolvedSessionModel: string | null | undefined,
  transcriptModel: string | null | undefined
): number | null {
  const resolved = resolvedSessionModel?.trim() ?? ''
  if (!LONG_CONTEXT_SUFFIX.test(resolved) || !transcriptModel) {
    return null
  }
  // Why: a tracked model the transcript contradicts is stale (e.g. switched in the TUI).
  const resolvedBase = resolved.replace(LONG_CONTEXT_SUFFIX, '').toLowerCase()
  return resolvedBase === transcriptModel.trim().toLowerCase()
    ? CLAUDE_LONG_CONTEXT_WINDOW_TOKENS
    : null
}
