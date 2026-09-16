// The adjacency proof itself: only the launch immediately after a shutdown can name it.
//
// Every failure mode here has to fail in the same direction — towards `previous: null`, which
// accepts no markers at all. An id that survives when it should not is what turns a resume marker
// back into a 24h write-ahead latch.

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  agentSessionLaunchFilePath,
  rotateAgentSessionLaunchGeneration
} from './agent-session-launch-generation'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-launch-generation-'))
})

afterEach(async () => {
  await chmod(directory, 0o700).catch(() => {})
  await rm(directory, { recursive: true, force: true })
})

describe('rotating the launch generation', () => {
  it('proves no predecessor on a first run', async () => {
    expect((await rotateAgentSessionLaunchGeneration(directory)).previous).toBeNull()
  })

  it('names the launch immediately before it', async () => {
    const first = await rotateAgentSessionLaunchGeneration(directory)

    const second = await rotateAgentSessionLaunchGeneration(directory)

    expect(second.previous).toBe(first.current)
    expect(second.current).not.toBe(first.current)
  })

  // The whole point: a generation is adjacent to exactly one successor. Two launches later, the
  // first launch's markers can no longer be claimed by anyone.
  it('is not adjacent to a launch two generations back', async () => {
    const first = await rotateAgentSessionLaunchGeneration(directory)
    await rotateAgentSessionLaunchGeneration(directory)

    const third = await rotateAgentSessionLaunchGeneration(directory)

    expect(third.previous).not.toBe(first.current)
  })

  it.each(['not json at all', '{}', '{"current":""}', '[]'])(
    'refuses to name a predecessor when the stamp reads %s',
    async (contents) => {
      await writeFile(agentSessionLaunchFilePath(directory), contents)

      expect((await rotateAgentSessionLaunchGeneration(directory)).previous).toBeNull()
    }
  )

  // A write that never lands is the dangerous case: the NEXT launch would read this launch's
  // predecessor and mistake it for its own, so this launch refuses adjacency in both directions.
  it('claims no predecessor when the new stamp could not be written', async () => {
    const first = await rotateAgentSessionLaunchGeneration(directory)
    await chmod(directory, 0o500)

    const second = await rotateAgentSessionLaunchGeneration(directory)

    expect(second.previous).toBeNull()
    expect(second.current).not.toBe(first.current)
  })

  it('claims no predecessor when the state directory does not exist', async () => {
    const missing = join(directory, 'never-created')

    expect((await rotateAgentSessionLaunchGeneration(missing)).previous).toBeNull()

    // And nothing was left behind for a later launch to read as a predecessor.
    await mkdir(missing, { recursive: true })
    expect((await rotateAgentSessionLaunchGeneration(missing)).previous).toBeNull()
  })
})
