import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'

export const RECORDER_DIRECTORY = 'mobile/src/test-support/rpc-recording'
/** The per-domain mount adapters. Excluded below and pinned per golden by `adapterSha256` instead. */
export const ADAPTER_DIRECTORY = `${RECORDER_DIRECTORY}/adapters`
const digests = new Map<string, string>()

function collect(root: string, relative: string, files: string[]): void {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    const child = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      if (child !== ADAPTER_DIRECTORY) {
        collect(root, child, files)
      }
    } else if (!entry.name.endsWith('.md')) {
      files.push(child)
    }
  }
}

/**
 * Every executable recorder input a golden shares with every other golden: the engine, and nothing
 * domain-specific. Prose is excluded because it cannot change a recording; a candidate run
 * recomputes this and `compareGolden` fails the header, which forces an engine edit to re-record
 * deliberately.
 *
 * Two inputs are deliberately absent, each for the same reason. The scenario manifest used to be
 * here, which made every golden's header a function of every other family's scenarios. The mount
 * adapters used to be here too, which made it a function of every other family's adapter: adding
 * one domain's module re-digested all 153 files and put a conflict on that line in every domain
 * branch in flight. `scenarioSha256` and `adapterSha256` pin each golden to its own instead.
 */
export function recorderSha256(root: string): string {
  const cached = digests.get(root)
  if (cached !== undefined) {
    return cached
  }
  const files: string[] = []
  collect(root, RECORDER_DIRECTORY, files)
  const digest = createHash('sha256')
    .update(
      files
        .map((file) => `${file}:${readFileSync(join(root, ...file.split(posix.sep)))}`)
        .join('\n')
    )
    .digest('hex')
  digests.set(root, digest)
  return digest
}
