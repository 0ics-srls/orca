// Claude's context window per model id, resolved the way the CLI does for its own
// statusline: the `[1m]` suffix opts a session into the 1M window, and every other
// id runs the standard window.

export const CLAUDE_STANDARD_CONTEXT_WINDOW_TOKENS = 200_000
export const CLAUDE_LONG_CONTEXT_WINDOW_TOKENS = 1_000_000

export function claudeContextWindowTokens(model: string | null | undefined): number {
  return model?.trim().toLowerCase().endsWith('[1m]')
    ? CLAUDE_LONG_CONTEXT_WINDOW_TOKENS
    : CLAUDE_STANDARD_CONTEXT_WINDOW_TOKENS
}
