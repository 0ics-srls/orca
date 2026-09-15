// Markers on disk: they survive a restart, they are spent exactly once, they expire, and a
// malformed one can never cost the user their session store.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_SESSION_RESUME_MARKER_TTL_MS,
  type AgentSessionResumeMarker
} from '../../shared/agent-session-resume-marker'
import { AgentSessionRecordStore } from './agent-session-record-store'
import { agentSessionStorePath } from './agent-session-record-store-file'

const NOW = 1_700_000_000_000
const SESSION = 'session-working-1'

function marker(overrides: Partial<AgentSessionResumeMarker> = {}): AgentSessionResumeMarker {
  return {
    sessionId: SESSION,
    turnId: 'turn-1',
    recordedAt: NOW,
    trigger: 'quit',
    providerHandleKey: 'codex:"thread-1"',
    ...overrides
  }
}

let root: string
let directory: string

async function openStore(): Promise<AgentSessionRecordStore> {
  return AgentSessionRecordStore.open({ directory, hostId: 'local' })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-resume-marker-'))
  directory = join(root, 'agent-sessions')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('durable resume markers', () => {
  // The transaction queue compares the state it is about to write against a snapshot; a markers-only
  // write is the one change that has no other field moving with it.
  it('persists a markers-only transaction across a restart', async () => {
    const store = await openStore()
    await store.resumeMarkers.record([marker()], NOW)

    const reopened = await openStore()

    expect(reopened.resumeMarkers.list(NOW)).toEqual([marker()])
  })

  it('replaces the whole set, so an earlier generation leaves nothing behind', async () => {
    const store = await openStore()
    await store.resumeMarkers.record([marker(), marker({ sessionId: 'session-working-2' })], NOW)

    await store.resumeMarkers.record([marker({ sessionId: 'session-working-2' })], NOW)

    expect((await openStore()).resumeMarkers.list(NOW).map((entry) => entry.sessionId)).toEqual([
      'session-working-2'
    ])
  })

  it('spends a marker exactly once', async () => {
    const store = await openStore()
    await store.resumeMarkers.record([marker()], NOW)

    expect(await store.resumeMarkers.consume(SESSION)).toBe(true)
    expect(await store.resumeMarkers.consume(SESSION)).toBe(false)
    expect((await openStore()).resumeMarkers.list(NOW)).toEqual([])
  })

  it('stops reporting a marker once it has expired', async () => {
    const store = await openStore()
    await store.resumeMarkers.record([marker()], NOW)

    expect(store.resumeMarkers.list(NOW + AGENT_SESSION_RESUME_MARKER_TTL_MS + 1)).toEqual([])
  })

  it('treats a marker from the future as expired rather than immortal', async () => {
    const store = await openStore()
    await store.resumeMarkers.record([marker({ recordedAt: NOW + 60_000 })], NOW + 60_000)

    expect(store.resumeMarkers.list(NOW)).toEqual([])
  })

  // Every other section of this file refuses the whole store on a malformed entry. A resume marker
  // is advisory, and must never be able to make a user's sessions unreadable.
  it('drops a malformed marker instead of failing the load', async () => {
    const store = await openStore()
    await store.resumeMarkers.record([marker()], NOW)
    const filePath = agentSessionStorePath(directory)
    const parsed = JSON.parse(await readFile(filePath, 'utf-8'))
    parsed.resumeMarkers = {
      [SESSION]: { sessionId: SESSION, turnId: 42, trigger: 'nonsense' },
      'session-working-2': marker({ sessionId: 'session-working-2' })
    }
    await writeFile(filePath, JSON.stringify(parsed))

    const reopened = await openStore()

    expect(reopened.resumeMarkers.list(NOW).map((entry) => entry.sessionId)).toEqual([
      'session-working-2'
    ])
  })

  it('reads a profile written before markers existed', async () => {
    const store = await openStore()
    // Recorded first only to create the file; the field is then stripped to model an older profile.
    await store.resumeMarkers.record([marker()], NOW)
    const filePath = agentSessionStorePath(directory)
    const parsed = JSON.parse(await readFile(filePath, 'utf-8'))
    delete parsed.resumeMarkers
    await writeFile(filePath, JSON.stringify(parsed))

    expect((await openStore()).resumeMarkers.list(NOW)).toEqual([])
  })
})
