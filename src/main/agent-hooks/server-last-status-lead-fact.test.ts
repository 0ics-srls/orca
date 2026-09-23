import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentHookServer, _internals } from './server'
import { buildBody, postHookEvent, recentTs, PANE } from './server.test-fixtures'

const { getCohortAtEmitMock, trackMock } = vi.hoisted(() => ({
  getCohortAtEmitMock: vi.fn(),
  trackMock: vi.fn()
}))

vi.mock('../telemetry/client', () => ({ track: trackMock }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: getCohortAtEmitMock }))

beforeEach(() => {
  _internals.resetCachesForTests()
  trackMock.mockReset()
  getCohortAtEmitMock.mockReset()
  getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// The lead fact rides inside the persisted payload. Without these pins the field would look
// shipped while dying at every restart: hydration rebuilds only the fields it is taught.
describe('The lead fact across a restart', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-lead-fact-'))
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  function lastStatusPath(): string {
    return join(userDataPath, 'agent-hooks', 'last-status.json')
  }

  function writeEntry(entry: Record<string, unknown>): void {
    mkdirSync(join(userDataPath, 'agent-hooks'), { recursive: true })
    writeFileSync(
      lastStatusPath(),
      JSON.stringify({
        version: 2,
        entries: { [PANE]: { paneKey: PANE, tabId: 'tab-1', ...entry } }
      })
    )
  }

  it('round-trips a settled lead held open by a child through disk and back', async () => {
    const firstServer = new AgentHookServer()
    await firstServer.start({ env: 'production', userDataPath })
    await postHookEvent(
      firstServer,
      buildBody({ hook_event_name: 'UserPromptSubmit', prompt: 'finish after child' })
    )
    await postHookEvent(
      firstServer,
      buildBody({ hook_event_name: 'SubagentStart', agent_id: 'arestored-child' })
    )
    await postHookEvent(firstServer, buildBody({ hook_event_name: 'Stop', is_interrupt: true }))
    const live = firstServer.getStatusSnapshot()[0]
    expect(live).toMatchObject({
      state: 'working',
      lead: { state: 'done', outcome: 'cancellation', stateStartedAt: expect.any(Number) }
    })
    firstServer.flushStatusPersistSync()
    firstServer.stop()
    const file = JSON.parse(readFileSync(lastStatusPath(), 'utf8'))
    expect(file.entries[PANE].payload.lead).toEqual(live?.lead)
    expect(file.entries[PANE]).not.toHaveProperty('claudeLeadBoundaryChildOnly')

    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      expect(server.getStatusSnapshot()[0]).toMatchObject({
        state: 'working',
        restoredUnconfirmed: true,
        lead: live?.lead
      })
      // The seeded lead record is what lets the child's drain settle the pane, verdict intact.
      await postHookEvent(
        server,
        buildBody({ hook_event_name: 'SubagentStop', agent_id: 'arestored-child' })
      )
      expect(server.getStatusSnapshot()[0]).toMatchObject({
        state: 'done',
        interrupted: true,
        lead: { state: 'done', outcome: 'cancellation', stateStartedAt: live?.lead?.stateStartedAt }
      })
    } finally {
      server.stop()
    }
  })

  it('maps the legacy child-only flag onto an absent lead, dated by the turn end', async () => {
    const receivedAt = recentTs()
    writeEntry({
      receivedAt,
      stateStartedAt: receivedAt - 5_000,
      claudeLeadBoundaryChildOnly: true,
      payload: {
        state: 'working',
        prompt: 'legacy row',
        agentType: 'claude',
        turnCompletedAt: receivedAt - 1_000,
        subagents: [{ id: 'arestored-child', state: 'working', startedAt: receivedAt - 4_000 }]
      }
    })
    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      expect(server.getStatusSnapshot()[0]).toMatchObject({
        state: 'working',
        lead: { state: 'done', stateStartedAt: receivedAt - 1_000 }
      })
      await postHookEvent(
        server,
        buildBody({ hook_event_name: 'SubagentStop', agent_id: 'arestored-child' })
      )
      expect(server.getStatusSnapshot()[0]).toMatchObject({
        state: 'done',
        lead: { state: 'done' }
      })
    } finally {
      server.stop()
    }
  })

  it('prefers a persisted lead over the legacy flag when a row carries both', async () => {
    const receivedAt = recentTs()
    const lead = { state: 'done', outcome: 'cancellation', stateStartedAt: receivedAt - 2_000 }
    writeEntry({
      receivedAt,
      stateStartedAt: receivedAt - 5_000,
      claudeLeadBoundaryChildOnly: true,
      payload: {
        state: 'working',
        prompt: 'both',
        agentType: 'claude',
        turnCompletedAt: receivedAt - 1_000,
        lead,
        subagents: [{ id: 'arestored-child', state: 'working', startedAt: receivedAt - 4_000 }]
      }
    })
    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      expect(server.getStatusSnapshot()[0]?.lead).toEqual(lead)
    } finally {
      server.stop()
    }
  })

  it('drops a malformed persisted lead and keeps the row', async () => {
    const receivedAt = recentTs()
    writeEntry({
      receivedAt,
      stateStartedAt: receivedAt - 5_000,
      payload: { state: 'done', prompt: 'survived', agentType: 'claude', lead: 'done' }
    })
    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      const row = server.getStatusSnapshot()[0]
      expect(row).toMatchObject({ state: 'done', prompt: 'survived' })
      expect(row?.lead).toBeUndefined()
    } finally {
      server.stop()
    }
  })

  it('never invents a lead for a non-Claude row from the legacy flag', async () => {
    const receivedAt = recentTs()
    writeEntry({
      receivedAt,
      stateStartedAt: receivedAt - 5_000,
      claudeLeadBoundaryChildOnly: true,
      payload: { state: 'working', prompt: 'codex row', agentType: 'codex' }
    })
    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      expect(server.getStatusSnapshot()[0]?.lead).toBeUndefined()
    } finally {
      server.stop()
    }
  })
})
