// A child that dies between spawn and journal attach can still write through the host's event
// sink, which attach unbound and never re-bound. That queue must die with the failed create, or
// the next attach's drain barrier and shutdown's flush wait on it forever.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_THREAD as THREAD,
  hostTestAttachParams,
  resetHostTestOperationIds
} from './structured-agent-session-host-test-data'

const CALLER = { callerKey: 'client-1' }
const EXIT_REASON = 'claude stream-json exited (code 1): claude: not signed in'

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost
let acquire: Mock<StructuredAgentSessionAdapter['acquire']>

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-failed-create-sink-'))
  resetHostTestOperationIds()
  acquire = vi.fn(async ({ fence, spawnToken }) => ({
    process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
    link: {
      linkId: `link-${fence}`,
      handle: { provider: 'codex', threadId: THREAD },
      origin: 'created',
      mintedAtFence: fence,
      observedAt: NOW
    }
  }))
  store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
  host = new StructuredAgentSessionHost({
    store,
    adapter: {
      acquire,
      releaseAcquisition: vi.fn(async () => true),
      dispatch: vi.fn(async () => ({ state: 'admitted' as const })),
      cancelTurn: vi.fn(async () => ({ cancelled: true })),
      answerPrompt: vi.fn(async () => undefined),
      setOption: vi.fn(async () => undefined)
    },
    journalRoot: root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-a',
    now: () => NOW
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('a create that throws after its child wrote through the unbound sink', () => {
  it('releases the sink, so a new create and shutdown both proceed', async () => {
    acquire.mockImplementationOnce(async ({ events }) => {
      // The published child's exit reached the translator before any journal was attached.
      events?.setActivity?.(null)
      throw new Error(EXIT_REASON)
    })

    await expect(host.attach(CALLER, hostTestAttachParams(null))).rejects.toThrow(EXIT_REASON)

    await expect(host.attach(CALLER, hostTestAttachParams(null))).resolves.toMatchObject({
      ok: true
    })
    await expect(host.flushAllStreamedEvents()).resolves.toBeUndefined()
    expect(acquire).toHaveBeenCalledTimes(2)
  })
})
