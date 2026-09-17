import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import process from 'node:process'

// A NUL byte in a source file makes git classify it as BINARY.
//
// The cost is entirely to review and tooling, not to the running app: the file compiles, every
// test passes, and the UI behaves — which is exactly why nothing catches it. A reviewer sees
// "Binary file not shown" instead of the diff, and `rg` skips the file silently, so a grep over it
// returns no matches rather than an error. Both failures are quiet.
//
// This happens when an escape like `'\0'` is written as the raw byte instead of the two characters.
// The fix is always to write the escape; the runtime string is identical either way.
//
// Runs over the files it is given (the pre-commit hook passes staged paths) or, with no arguments,
// every tracked file with a source extension. Files already carrying a NUL when this gate landed are
// grandfathered in `config/nul-byte-baseline.txt`; that list may only shrink.

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.css',
  '.html',
  '.md',
  '.yml',
  '.yaml'
])

function hasSourceExtension(file) {
  const dot = file.lastIndexOf('.')
  return dot !== -1 && SOURCE_EXTENSIONS.has(file.slice(dot))
}

function trackedSourceFiles() {
  return execFileSync('git', ['ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter((file) => file !== '' && hasSourceExtension(file))
}

/** Byte offsets of every NUL, read as BYTES: decoding to a string first would lose them. */
export function nulOffsets(buffer) {
  const offsets = []
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0) {
      offsets.push(index)
    }
  }
  return offsets
}

function lineOf(buffer, offset) {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (buffer[index] === 0x0a) {
      line += 1
    }
  }
  return line
}

const BASELINE_PATH = 'config/nul-byte-baseline.txt'

function baseline() {
  try {
    return new Set(
      fs
        .readFileSync(BASELINE_PATH, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    )
  } catch {
    return new Set()
  }
}

const grandfathered = baseline()
const requested = process.argv.slice(2)
const files = requested.length > 0 ? requested.filter(hasSourceExtension) : trackedSourceFiles()
const findings = []
/** Baseline entries that are now clean, so the list can be told to shrink. */
const cleared = []

for (const file of files) {
  let buffer
  try {
    buffer = fs.readFileSync(file)
  } catch {
    // Deleted or unreadable between listing and reading; nothing to police.
    continue
  }
  const offsets = nulOffsets(buffer)
  if (offsets.length === 0) {
    cleared.push(file)
    continue
  }
  if (grandfathered.has(file)) {
    continue
  }
  for (const offset of offsets) {
    findings.push({ file, line: lineOf(buffer, offset), offset })
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line} contains a raw NUL byte at offset ${finding.offset}. ` +
        `Write it as the escape (\\0) so the file stays text; the runtime string is unchanged.`
    )
  }
  console.error(
    `\nNUL bytes found in ${new Set(findings.map((entry) => entry.file)).size} file(s). ` +
      `git would classify them as binary, hiding the diff from review.`
  )
  process.exit(1)
}

const fixed = cleared.filter((file) => grandfathered.has(file))
if (fixed.length > 0 && requested.length === 0) {
  for (const file of fixed) {
    console.error(`${file} no longer contains a NUL byte; remove it from ${BASELINE_PATH}.`)
  }
  process.exit(1)
}

console.log(
  `no new NUL bytes in ${files.length} source file(s) (${grandfathered.size} grandfathered).`
)
