/**
 * Checked-in performance budget for the shared browser-history matcher, measured
 * against the synthetic corpus in `browser-history-match.performance.test.ts`.
 * These are ceilings for catching order-of-magnitude regressions, not targets —
 * the measured numbers on a developer machine sit far under each one.
 *
 * The ceilings are asserted against the *fastest* sample of a batch, never the
 * slowest: a vitest worker sharing cores with the rest of the suite gets
 * preempted mid-measurement, so the slowest sample measures the machine while
 * the fastest still approximates the matcher.
 *
 * Raising any value requires a fresh measurement recorded in the PR.
 */
export const BROWSER_HISTORY_MATCH_BUDGET = {
  /** Entries prepared in one omnibox open. Tracks MAX_BROWSER_HISTORY_ENTRIES. */
  candidateCount: 200,
  /** Milliseconds to prepare the whole corpus once (cold open), fastest sample. Measured 0.08 ms. */
  prepareMs: 2,
  /** Milliseconds to match the prepared corpus against one query, fastest sample. Measured 0.03 ms. */
  matchMs: 2
} as const
