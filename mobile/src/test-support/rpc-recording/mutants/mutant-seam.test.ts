import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MUTANT_DIRECTORY, RECORDER_DIRECTORY } from '../recorder-digest'
import { RECORDING_DRIVERS } from '../recording-drivers'

const root = resolve(import.meta.dirname, '../../../../..')
const recorder = join(root, RECORDER_DIRECTORY)
const mutants = join(root, MUTANT_DIRECTORY)
/** The one file allowed to name this directory: it names it in order to exclude it. */
const EXCLUDER = 'recorder-digest.ts'

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
}

/**
 * `recorderSha256` skips this directory, so nothing here is pinned by any golden. That is only
 * sound while no recording can reach it: a mutant table an adapter imported would change what the
 * recording loads while every header stayed still. Reaching a module takes importing it, so the
 * import scan is the reachability argument; the second check keeps the path out of non-test code,
 * where it could be read rather than imported.
 */
describe('the mutant seam', () => {
  const outside = sources(recorder).filter((file) => !file.startsWith(`${mutants}/`))

  it('is imported by nothing outside itself', () => {
    const importers = outside
      .filter((file) =>
        [...readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*'([^']*)'/g)].some((match) =>
          match[1]!.includes('mutants/')
        )
      )
      .map((file) => file.slice(recorder.length + 1))
    expect(importers).toEqual([])
    // Neither side may be empty, or the scan above would pass by scanning nothing.
    expect(outside.length).toBeGreaterThan(1)
    expect(sources(mutants).length).toBeGreaterThan(1)
  })

  // A test that does not record cannot change a recording; the drivers do record, so they are held
  // to the engine's rule — a driver that read the table would change what it records silently.
  it('is named in no recording file but the digest that excludes it', () => {
    const naming = outside
      .filter(
        (file) =>
          !file.endsWith(EXCLUDER) &&
          !(
            file.endsWith('.test.ts') && !RECORDING_DRIVERS.some((driver) => file.endsWith(driver))
          ) &&
          readFileSync(file, 'utf8').includes('mutants')
      )
      .map((file) => file.slice(recorder.length + 1))
    expect(naming).toEqual([])
  })
})
