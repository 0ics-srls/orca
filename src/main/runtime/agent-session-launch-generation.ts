// The identity of ONE app launch, used to prove a resume marker came from the shutdown immediately
// before this launch and not from some older one.
//
// WHY ITS OWN FILE, WITH NO BACKUP COPY. The adjacency proof is worthless if it can roll back in
// step with the thing it is proving. Two stores were considered and both were rejected by
// inspection, not by name:
//
//   - the agent-session store itself keeps `<file>.bak` and `loadAgentSessionStore` falls back to
//     it, so a marker and its stamp would roll back together and the check would pass on exactly
//     the path it exists to catch;
//   - the profile store has its own rotation (`loading-store/backup-recovery-rotation.ts`, reached
//     from `loaded-state-parsing.ts` via `restoreFromBackup`), so it can independently rewind and
//     carry a stale "previous launch" forward.
//
// A file with no backup mechanism cannot roll back. It is either the value this launch wrote or it
// is absent — and absent refuses every marker, which is the direction we want to fail.
//
// Rotation happens ONCE per launch: whatever is on disk is the previous launch's id, and it is
// immediately replaced. A rollback of either store can then only cause an UNDER-offer (ids fail to
// match), never an over-offer.

import { readFile, rm } from 'node:fs/promises'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { durableWriteTempPath, renameDurable, writeTempFileDurable } from '../durable-file-write'

export const AGENT_SESSION_LAUNCH_FILE_NAME = 'agent-session-launch.json'

export type AgentSessionLaunchGeneration = {
  /** This launch. Teardown stamps every marker it writes with this. */
  current: string
  /** The launch immediately before this one, or null when it cannot be proved — a first run, an
   *  unreadable file, or a write that failed. Null accepts NO markers. */
  previous: string | null
}

export function agentSessionLaunchFilePath(stateDirectory: string): string {
  return join(stateDirectory, AGENT_SESSION_LAUNCH_FILE_NAME)
}

/** The stamp file's shape. Parsed rather than read field-by-field: the file is JSON this process
 *  may not have written, and an unreadable one must fail closed rather than half-read. */
const launchStampSchema = z.object({ current: z.string().min(1) })

function readLaunchId(raw: string): string | null {
  try {
    const parsed = launchStampSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.current : null
  } catch {
    return null
  }
}

/**
 * Reads the previous launch's id and replaces it with a fresh one, durably, before anything can act
 * on a marker.
 *
 * Fails CLOSED in both directions: an unreadable file yields `previous: null`, and a failed write
 * also yields `previous: null` rather than letting this launch claim adjacency it cannot prove —
 * because if the new id never lands, the NEXT launch would read this launch's predecessor and
 * wrongly believe itself adjacent to it.
 */
export async function rotateAgentSessionLaunchGeneration(
  stateDirectory: string
): Promise<AgentSessionLaunchGeneration> {
  const filePath = agentSessionLaunchFilePath(stateDirectory)
  let previous: string | null = null
  try {
    previous = readLaunchId(await readFile(filePath, 'utf-8'))
  } catch {
    // Absent or unreadable: this launch can prove nothing, so it will accept nothing.
    previous = null
  }
  const current = randomUUID()
  const tmpPath = durableWriteTempPath(filePath)
  try {
    await writeTempFileDurable(tmpPath, JSON.stringify({ current }), 0o600)
    await renameDurable(tmpPath, filePath)
  } catch {
    await rm(tmpPath, { force: true }).catch(() => {})
    // The stamp this launch would write could never be proved adjacent by the next launch, and the
    // next launch would mistake our predecessor for its own. Refuse both directions.
    return { current, previous: null }
  }
  return { current, previous }
}
