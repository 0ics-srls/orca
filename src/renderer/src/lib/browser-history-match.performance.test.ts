import { describe, expect, it } from 'vitest'
import { BROWSER_HISTORY_MATCH_BUDGET } from './browser-history-match-budget'
import { matchBrowserHistory, prepareBrowserHistoryEntries } from './browser-history-match'
import { MAX_BROWSER_HISTORY_ENTRIES } from '../../../shared/workspace-session-browser-history'
import type { BrowserHistoryEntry } from '../../../shared/browser-workspace-types'

const { candidateCount, matchMs, prepareMs } = BROWSER_HISTORY_MATCH_BUDGET

const LONG_PATH =
  'engineering/platform/runtime/observability/dashboards/incident-review/2026-08-27/rollout'

function makeEntry(index: number): BrowserHistoryEntry {
  const url = `https://service-${index % 23}.internal.example.com/${LONG_PATH}/${index}?tab=overview&window=7d&team=platform#section-${index % 9}`
  return {
    url,
    normalizedUrl: url,
    title: `Incident review ${index} — platform runtime observability rollout status`,
    lastVisitedAt: Date.now() - index * 60_000,
    visitCount: index % 140
  }
}

const entries = Array.from({ length: candidateCount }, (_, index) => makeEntry(index))
// The worst realistic query: matches nothing early, so every entry is scanned in full.
const WORST_QUERY = 'observability rollout'

/**
 * Why the fastest sample and not p95: this runs in a vitest worker competing for
 * cores with the rest of the suite, so a slow sample records a preemption rather
 * than the matcher. Measured across idle and full-suite runs, the fastest sample
 * moved 0.05 ms -> 0.08 ms while p95 of the same batches swung 0.09 ms -> 0.50 ms.
 */
function fastestSample(samples: readonly number[]): number {
  return Math.min(...samples)
}

describe('browser history match performance budget', () => {
  // Why assert the constant: raising the store cap must fail here until the
  // budget is re-measured, which a comment on the field would not do.
  it('tracks the store cap the budget was measured against', () => {
    expect(candidateCount).toBe(MAX_BROWSER_HISTORY_ENTRIES)
  })

  it('prepares a cold corpus within budget', () => {
    prepareBrowserHistoryEntries(entries)
    const samples: number[] = []
    for (let run = 0; run < 20; run += 1) {
      const start = performance.now()
      // Use a fresh array identity so this measures preparation rather than
      // the identity cache used by live address bars and omniboxes.
      prepareBrowserHistoryEntries(entries.slice())
      samples.push(performance.now() - start)
    }
    expect(fastestSample(samples)).toBeLessThan(prepareMs)
  })

  it('matches one query against the prepared corpus within budget', () => {
    const prepared = prepareBrowserHistoryEntries(entries)
    const run = (): void => {
      matchBrowserHistory({ prepared, query: WORST_QUERY, limit: 3 })
    }
    // Warm the matcher before timing so JIT compilation is not part of the samples.
    run()
    const samples: number[] = []
    for (let index = 0; index < 20; index += 1) {
      const start = performance.now()
      run()
      samples.push(performance.now() - start)
    }
    expect(fastestSample(samples)).toBeLessThan(matchMs)
  })
})
