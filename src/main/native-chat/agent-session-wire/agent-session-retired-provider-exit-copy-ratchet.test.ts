import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanSourceTree, stripComments } from '../../../shared/source-scan/source-tree-scan'

/**
 * The retired copy has to stay retired.
 *
 * `withoutRetiredProviderExitStatusItems` hides a status row on TWO facts: a
 * `restart-eviction:<sessionId>:<fence>` item id, and copy that starts with the retired prefix.
 * The identity half is still minted today, so the filter cannot tell a new producer's row from
 * the legacy row it exists to hide — anything that writes this copy again would be dropped from
 * every transcript with no trace. No production writer is left, and this is what keeps it so.
 *
 * Deliberately narrow: only a literal that OPENS with the prefix, which is exactly what the
 * filter's `startsWith` reads. Prose about the retirement is not a producer.
 */

const RETIRED_COPY_PREFIX = 'Provider exited'

/** The filter compares against the prefix rather than writing it, so it owns the one literal. */
const FILTER_SOURCE_PATH =
  'main/native-chat/agent-session-wire/agent-session-retired-provider-exit-status-filter.ts'

/** Line numbers of string literals whose first character begins the retired copy. */
export function findRetiredProviderExitCopyLines(source: string): number[] {
  const code = stripComments(source)
  const pattern = new RegExp(`['"\`]${RETIRED_COPY_PREFIX}`, 'g')
  return [...code.matchAll(pattern)].map((match) => code.slice(0, match.index).split('\n').length)
}

describe('retired provider-exit copy ratchet', () => {
  it('flags a literal that opens with the retired copy', () => {
    const flagged = [
      `const text = 'Provider exited: recorded pid absent on host'`,
      `appendStatus("Provider exited")`,
      'appendStatus(`Provider exited: ${reason}`)'
    ]
    for (const source of flagged) {
      expect(findRetiredProviderExitCopyLines(source), source).toHaveLength(1)
    }
  })

  it('reports the line the literal sits on', () => {
    expect(findRetiredProviderExitCopyLines(`const a = 1\n\nconst b = 'Provider exited'`)).toEqual([
      3
    ])
  })

  it('leaves prose and unrelated copy alone', () => {
    const allowed = [
      `// the old bare 'Provider exited: <reason>' row`,
      `/* wrote \`Provider exited\` once */`,
      `const text = 'provider exited'`,
      `const text = 'The provider exited unexpectedly'`,
      `const text = 'Provider exit was not proven'`,
      `if (text.startsWith(prefix)) {}`
    ]
    for (const source of allowed) {
      expect(findRetiredProviderExitCopyLines(source), source).toEqual([])
    }
  })

  const repoRoot = resolve(__dirname, '..', '..', '..', '..')
  // Tests write the retired copy on purpose: that is how the filter is exercised.
  const files = scanSourceTree(join(repoRoot, 'src'))

  it('scans a plausible number of files', () => {
    // A broken root or extension list would make the guard silently vacuous.
    expect(files.length).toBeGreaterThan(500)
  })

  it('has no production writer of the retired copy', () => {
    const offenders = files
      .filter(({ relativePath }) => relativePath !== FILTER_SOURCE_PATH)
      .flatMap(({ relativePath, source }) =>
        findRetiredProviderExitCopyLines(source).map((line) => `src/${relativePath}:${line}`)
      )
    expect(
      offenders,
      `A status row whose copy opens with "${RETIRED_COPY_PREFIX}" is hidden from every transcript by ` +
        'agent-session-retired-provider-exit-status-filter.ts whenever it also carries a ' +
        'restart-eviction identity, which is still minted. Write the outcome copy the death ' +
        'evidence decides instead of resurrecting the retired prefix.'
    ).toEqual([])
  })
})
